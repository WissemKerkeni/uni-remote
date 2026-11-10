// In-app simulator of the UniRemote firmware protocol (docs/BLE_PROTOCOL.md).
// Used for "Demo mode" and for automated protocol tests. It mirrors the
// firmware's validation, duplicate-id handling, learning and duty-cycle rules,
// but obviously does not touch any radio.
import { utf8Encode } from '../protocol/bytes';
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION } from '../protocol/constants';
import { LineAssembler, splitChunks } from '../protocol/framing';
import { estimateAirtimeMs, LIMITS, protocolName, PROTOCOLS, toBinary, toHex, toTriState, validateSignal } from '../domain/signal';
import type { RfSignal } from '../domain/types';

type Json = Record<string, any>;

export interface MockDeviceOptions {
  /** Delay before each response, ms. */
  latencyMs?: number;
  /** Bytes per notification (simulates the BLE MTU). */
  chunkSize?: number;
  /** When learning, emit a simulated button press after this delay (ms). 0 = never. */
  autoCaptureDelayMs?: number;
  /** Drop the first response to this request type once (tests retries). */
  dropFirstResponseOf?: string;
}

const DEMO_CODES: RfSignal[] = [
  { protocol: 1, bitLength: 24, value: '5393', pulseLength: 320, repeat: 10 },
  { protocol: 1, bitLength: 24, value: '5396', pulseLength: 320, repeat: 10 },
  { protocol: 1, bitLength: 24, value: '1381717', pulseLength: 350, repeat: 10 },
  { protocol: 1, bitLength: 24, value: '1381716', pulseLength: 350, repeat: 10 },
  { protocol: 2, bitLength: 24, value: '11259375', pulseLength: 650, repeat: 10 },
  { protocol: 11, bitLength: 12, value: '2730', pulseLength: 270, repeat: 10 },
];

const STORE_CAPACITY = 32;

export class MockDevice {
  readonly name = 'UniRemote-DEMO';
  private assembler = new LineAssembler(MAX_MESSAGE_BYTES);
  private cache: { id: string; type: string; line: string }[] = [];
  private learning: { requestId: string; single: boolean; timings: boolean; timer?: any; captureTimer?: any } | null = null;
  private stored = new Map<number, { name: string; signal: RfSignal }>();
  private config = { rxPin: 27, txPin: 26, ledPin: 2, rxTolerance: 60, defaultRepeat: 10 };
  private pendingConfig: typeof this.config | null = null;
  private budgetMs = 6000;
  private budgetAt = Date.now();
  private lastTxEnd = 0;
  private bootAt = Date.now();
  private demoIndex = 0;
  private currentType = '';
  private dropped = new Set<string>();
  private counters = { msgIn: 0, msgOut: 0, txOk: 0, txRejected: 0, rxSignals: 0, parseErrors: 0, duplicateRequests: 0 };
  private log: { ms: number; msg: string }[] = [];

  constructor(
    private readonly emitBytes: (chunk: Uint8Array) => void,
    private readonly opts: MockDeviceOptions = {},
  ) {
    this.addLog('I/sys: simulator booted');
  }

  // ------------------------------------------------------------- input side

  receive(chunk: Uint8Array) {
    const { lines, overflowed } = this.assembler.push(chunk);
    if (overflowed) this.sendError(undefined, 'too_large', `message exceeds ${MAX_MESSAGE_BYTES} bytes`);
    for (const l of lines) this.handleLine(l);
  }

  /** Test/demo hook: behave as if a remote button was pressed near the receiver. */
  simulateButtonPress(signal?: RfSignal, frames = 6) {
    if (!this.learning) return false;
    const s = signal ?? DEMO_CODES[this.demoIndex++ % DEMO_CODES.length];
    const sig = { ...s, repeat: this.config.defaultRepeat };
    this.counters.rxSignals++;
    const msg: Json = {
      type: 'signal_received',
      requestId: this.learning.requestId || undefined,
      signal: { ...sig, protocolName: protocolName(sig.protocol) },
      frames,
      durationMs: frames * 40,
      frequencyMHz: 433.92,
      frequencySource: 'nominal',
      modulation: 'ASK/OOK',
      encoding: 'fixed_code',
      decoded: { hex: toHex(sig), binary: toBinary(sig), triState: toTriState(sig) },
    };
    if (this.learning.timings) msg.timings = fakeTimings(sig);
    this.addLog(`I/rf: signal proto=${sig.protocol} bits=${sig.bitLength} value=${sig.value}`);
    this.emit(msg);
    if (this.learning.single) this.stopLearning('captured');
    return true;
  }

  shutdown() {
    if (this.learning) {
      clearTimeout(this.learning.timer);
      clearTimeout(this.learning.captureTimer);
      this.learning = null;
    }
  }

  // ------------------------------------------------------------- dispatcher

  private handleLine(line: string) {
    this.counters.msgIn++;
    let req: Json;
    try {
      req = JSON.parse(line);
    } catch {
      this.counters.parseErrors++;
      return this.sendError(undefined, 'bad_json', 'InvalidInput');
    }
    if (typeof req !== 'object' || req === null || Array.isArray(req)) {
      return this.sendError(undefined, 'bad_request', 'message must be a JSON object');
    }
    const id: string | undefined = typeof req.id === 'string' ? req.id : undefined;
    if (typeof req.type !== 'string') return this.sendError(id, 'bad_request', 'missing type');
    if (req.v !== undefined && req.v !== PROTOCOL_VERSION)
      return this.sendError(id, 'bad_request', `unsupported protocol version (device speaks v${PROTOCOL_VERSION})`);

    const cached = id ? this.cache.find((c) => c.id === id && c.type === req.type) : undefined;
    this.currentType = req.type;
    if (cached) {
      this.counters.duplicateRequests++;
      return this.later(() => this.emitLine(cached.line));
    }

    switch (req.type) {
      case 'get_info':
        return this.reply(id, 'device_info', this.info());
      case 'ping':
        return this.reply(id, 'pong', { uptimeMs: this.uptime(), echo: req.echo });
      case 'get_diagnostics':
        return this.reply(id, 'diagnostics', this.diagnostics(req.logLines ?? 20));
      case 'rx_probe': {
        // A healthy super-regenerative receiver outputs constant noise.
        const ms = Math.min(2000, Math.max(100, Number.isInteger(req.durationMs) ? req.durationMs : 500));
        const eps = 1800 + Math.round(Math.random() * 600);
        return this.reply(id, 'rx_probe_result', {
          rxPin: this.config.rxPin,
          durationMs: ms,
          edges: Math.round((eps * ms) / 1000),
          edgesPerSecond: eps,
          highRatio: 0.42,
          verdict: 'active',
        });
      }
      case 'loopback_test': {
        if (this.learning) return this.sendError(id, 'busy', 'stop learning first');
        const sent: RfSignal = { protocol: 1, bitLength: 24, value: String(0xa5c3f0 ^ Math.floor(Math.random() * 16)), pulseLength: 350, repeat: 8 };
        this.counters.txOk++;
        return this.reply(id, 'loopback_result', {
          match: true,
          received: true,
          framesDecoded: 6,
          sent: { ...sent, protocolName: protocolName(1) },
          got: { ...sent, pulseLength: 352, repeat: 1, protocolName: protocolName(1) },
        });
      }
      case 'learn_start':
        return this.learnStart(id, req);
      case 'learn_stop': {
        const was = !!this.learning;
        this.reply(id, 'ack', { ok: true, wasLearning: was });
        if (was) this.stopLearning('stopped');
        return;
      }
      case 'transmit': {
        const signal = parseSignal(req.signal, this.config.defaultRepeat);
        if (typeof signal === 'string') return this.sendError(id, 'invalid_signal', signal);
        return this.transmit(id, signal);
      }
      case 'transmit_stored': {
        const s = this.stored.get(req.slot);
        if (!s) return this.sendError(id, 'not_found', 'no stored signal in that slot');
        return this.transmit(id, s.signal);
      }
      case 'store_signal': {
        const signal = parseSignal(req.signal, LIMITS.defaultRepeat);
        if (typeof signal === 'string') return this.sendError(id, 'invalid_signal', signal);
        let slot: number = Number.isInteger(req.slot) ? req.slot : -1;
        if (slot === -1) {
          for (let i = 0; i < STORE_CAPACITY; i++)
            if (!this.stored.has(i)) {
              slot = i;
              break;
            }
          if (slot === -1) return this.sendError(id, 'storage_full', `all ${STORE_CAPACITY} slots are used`);
        }
        if (slot < 0 || slot >= STORE_CAPACITY) return this.sendError(id, 'bad_request', 'slot out of range');
        this.stored.set(slot, { name: String(req.name ?? '').slice(0, 32), signal });
        return this.reply(id, 'ack', { ok: true, slot }, true);
      }
      case 'list_stored':
        return this.reply(id, 'stored_list', {
          capacity: STORE_CAPACITY,
          count: this.stored.size,
          items: [...this.stored.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([slot, s]) => ({ slot, name: s.name, signal: { ...s.signal, protocolName: protocolName(s.signal.protocol) } })),
        });
      case 'delete_stored':
        if (!this.stored.delete(req.slot)) return this.sendError(id, 'not_found', 'no stored signal in that slot');
        return this.reply(id, 'ack', { ok: true }, true);
      case 'clear_stored':
        this.stored.clear();
        return this.reply(id, 'ack', { ok: true }, true);
      case 'get_config':
        return this.reply(id, 'config', { config: this.configJson() });
      case 'set_config': {
        const err = this.applyConfig(req.config);
        if (err) return this.sendError(id, 'invalid_config', err);
        return this.reply(id, 'config', { config: this.configJson() }, true);
      }
      case 'reset_config':
        this.pendingConfig = { rxPin: 27, txPin: 26, ledPin: 2, rxTolerance: 60, defaultRepeat: 10 };
        return this.reply(id, 'config', { config: this.configJson() }, true);
      case 'reboot':
        this.reply(id, 'ack', { ok: true }, true);
        if (this.pendingConfig) {
          this.config = this.pendingConfig;
          this.pendingConfig = null;
        }
        this.bootAt = Date.now();
        return;
      default:
        return this.sendError(id, 'unknown_type', `unknown message type '${String(req.type).slice(0, 40)}'`);
    }
  }

  private learnStart(id: string | undefined, req: Json) {
    const timeout = req.timeoutMs ?? 30000;
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 120000)
      return this.sendError(id, 'bad_request', 'timeoutMs must be 1000..120000');
    if (this.learning) this.stopLearning('restarted');
    const single = req.single !== false;
    this.learning = { requestId: id ?? '', single, timings: req.includeTimings === true };
    this.reply(id, 'ack', { ok: true }, true);
    this.later(() => this.emit({ type: 'learn_state', active: true, requestId: id, timeoutMs: timeout, single }));
    this.learning.timer = setTimeout(() => this.stopLearning('timeout'), timeout);
    const auto = this.opts.autoCaptureDelayMs ?? 0;
    if (auto > 0) {
      const tick = () => {
        if (!this.learning) return;
        this.simulateButtonPress();
        if (this.learning) this.learning.captureTimer = setTimeout(tick, auto);
      };
      this.learning.captureTimer = setTimeout(tick, auto);
    }
  }

  private stopLearning(reason: string) {
    if (!this.learning) return;
    const { requestId, timer, captureTimer } = this.learning;
    clearTimeout(timer);
    clearTimeout(captureTimer);
    this.learning = null;
    this.later(() => this.emit({ type: 'learn_state', active: false, reason, requestId: requestId || undefined }));
  }

  private transmit(id: string | undefined, s: RfSignal) {
    const airtime = estimateAirtimeMs(s);
    const now = Date.now();
    this.budgetMs = Math.min(6000, this.budgetMs + (now - this.budgetAt) * 0.1);
    this.budgetAt = now;
    if (this.lastTxEnd && now - this.lastTxEnd < 100) {
      this.counters.txRejected++;
      return this.sendError(id, 'rate_limited', 'transmitting too fast', 100 - (now - this.lastTxEnd));
    }
    if (this.budgetMs < airtime) {
      this.counters.txRejected++;
      return this.sendError(id, 'rate_limited', 'duty-cycle budget exhausted (10% limit)', Math.ceil((airtime - this.budgetMs) * 10));
    }
    this.reply(id, 'ack', { ok: true, estimatedAirtimeMs: airtime }, true);
    this.budgetMs -= airtime;
    this.lastTxEnd = now + airtime;
    setTimeout(() => {
      this.counters.txOk++;
      this.addLog(`I/rf: tx proto=${s.protocol} bits=${s.bitLength} value=${s.value} x${s.repeat}`);
      this.emit({ type: 'tx_done', id, ok: true, durationMs: airtime, repeat: s.repeat });
    }, airtime + (this.opts.latencyMs ?? 0));
  }

  private applyConfig(c: Json): string | null {
    if (typeof c !== 'object' || c === null) return 'missing config object';
    const allowedRx = [4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39];
    const allowedTx = [4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
    const next = { ...(this.pendingConfig ?? this.config), ...c };
    if (!allowedRx.includes(next.rxPin)) return `GPIO${next.rxPin} is not allowed for the receiver`;
    if (!allowedTx.includes(next.txPin)) return `GPIO${next.txPin} is not allowed for the transmitter`;
    if (next.rxPin === next.txPin) return 'rxPin and txPin must differ';
    this.config.defaultRepeat = next.defaultRepeat;
    this.pendingConfig = next;
    return null;
  }

  private configJson() {
    const p = this.pendingConfig;
    const reboot = !!p && (p.rxPin !== this.config.rxPin || p.txPin !== this.config.txPin || p.ledPin !== this.config.ledPin || p.rxTolerance !== this.config.rxTolerance);
    return {
      ...this.config,
      rebootRequired: reboot,
      pending: reboot ? { rxPin: p!.rxPin, txPin: p!.txPin, ledPin: p!.ledPin, rxTolerance: p!.rxTolerance } : undefined,
      allowedRxPins: [4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
      allowedTxPins: [4, 13, 14, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33],
    };
  }

  private info() {
    return {
      name: this.name,
      firmwareVersion: '1.0.0-sim',
      protocolVersion: PROTOCOL_VERSION,
      target: 'Simulator',
      chipModel: 'Simulated ESP32',
      chipRevision: 0,
      cpuCores: 2,
      flashSize: 4194304,
      bleAddress: '00:00:00:00:00:00',
      sdk: 'sim',
      uptimeMs: this.uptime(),
      radio: {
        frequencyMHz: 433.92,
        frequencySource: 'nominal',
        modulation: 'ASK/OOK',
        rxReady: true,
        txReady: true,
        rxPin: this.config.rxPin,
        txPin: this.config.txPin,
      },
      capabilities: {
        maxMessageBytes: MAX_MESSAGE_BYTES,
        maxRepeat: LIMITS.maxRepeat,
        maxBitLength: LIMITS.maxBitLength,
        storeCapacity: STORE_CAPACITY,
        rawReplay: false,
        rollingCode: false,
        protocols: PROTOCOLS.map((p) => ({ id: p.id, name: p.name, pulseLength: p.pulse })),
      },
    };
  }

  private diagnostics(lines: number) {
    return {
      uptimeMs: this.uptime(),
      bootCount: 1,
      resetReason: 'power_on',
      freeHeap: 210000,
      minFreeHeap: 190000,
      cpuMhz: 240,
      counters: { ...this.counters },
      log: this.log.slice(-Math.max(0, Math.min(40, lines))),
      ble: { connected: true, subscribed: true, mtu: (this.opts.chunkSize ?? 244) + 3 },
      rf: { rxReady: true, txReady: true, learning: !!this.learning, dutyBudgetMs: Math.floor(this.budgetMs), dutyBudgetMaxMs: 6000 },
      store: { count: this.stored.size, capacity: STORE_CAPACITY },
    };
  }

  // ------------------------------------------------------------- output side

  private uptime() {
    return Date.now() - this.bootAt;
  }

  private addLog(msg: string) {
    this.log.push({ ms: this.uptime(), msg });
    if (this.log.length > 40) this.log.shift();
  }

  private reply(id: string | undefined, type: string, body: Json, cache = false) {
    const line = JSON.stringify({ v: PROTOCOL_VERSION, type, id, ...body });
    if (cache && id) {
      this.cache.push({ id, type: this.currentType, line });
      if (this.cache.length > 4) this.cache.shift();
    }
    const drop = this.opts.dropFirstResponseOf;
    if (drop && drop === type && id && !this.dropped.has(drop)) {
      this.dropped.add(drop);
      return; // simulate a lost notification
    }
    this.later(() => this.emitLine(line));
  }

  private sendError(id: string | undefined, code: string, message: string, retryAfterMs?: number) {
    this.later(() => this.emitLine(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', id, code, message, retryAfterMs })));
  }

  private emit(msg: Json) {
    this.emitLine(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }));
  }

  private emitLine(line: string) {
    this.counters.msgOut++;
    const bytes = utf8Encode(line + '\n');
    for (const c of splitChunks(bytes, this.opts.chunkSize ?? 244)) this.emitBytes(c);
  }

  private later(fn: () => void) {
    const ms = this.opts.latencyMs ?? 0;
    if (ms > 0) setTimeout(fn, ms);
    else queueMicrotask(fn);
  }
}

function parseSignal(raw: Json, defaultRepeat: number): RfSignal | string {
  if (typeof raw !== 'object' || raw === null) return 'missing signal object';
  const s: RfSignal = {
    protocol: raw.protocol,
    bitLength: raw.bitLength,
    value: typeof raw.value === 'number' ? String(raw.value) : raw.value,
    pulseLength: raw.pulseLength ?? 0,
    repeat: raw.repeat ?? defaultRepeat,
  };
  return validateSignal(s) ?? s;
}

function fakeTimings(s: RfSignal): number[] {
  const t = PROTOCOLS.find((p) => p.id === s.protocol)!;
  const pulse = s.pulseLength || t.pulse;
  const jitter = () => Math.round((Math.random() - 0.5) * pulse * 0.15);
  const out = [t.sync[1] * pulse + jitter()];
  for (const bit of toBinary(s)) {
    const [h, l] = bit === '1' ? t.one : t.zero;
    out.push(h * pulse + jitter(), l * pulse + jitter());
  }
  return out;
}
