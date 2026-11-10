// Protocol client: request ids, acknowledgements, timeouts, retries and
// event fan-out. Transport-agnostic (BLE or simulator).
import { DEFAULT_TIMEOUT_MS, PROTOCOL_VERSION, TX_DONE_MARGIN_MS } from '../protocol/constants';
import { encodeMessage, LineAssembler } from '../protocol/framing';
import type {
  AckMsg,
  ConfigMsg,
  ConfigPatch,
  DeviceInfoMsg,
  DeviceMessage,
  DiagnosticsMsg,
  ErrorMsg,
  PongMsg,
  RxProbeResultMsg,
  LoopbackResultMsg,
  RequestBody,
  StoredListMsg,
  TxDoneMsg,
  WireSignalInput,
} from '../protocol/messages';
import { parseDeviceMessage } from '../protocol/validate';
import { Emitter, type Transport, type Unsubscribe } from '../transport/Transport';

export class DeviceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

interface Pending {
  resolve: (m: DeviceMessage) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface RequestOptions {
  timeoutMs?: number;
  /** Extra attempts after a timeout, reusing the same id (device de-duplicates). */
  retries?: number;
}

export interface ClientStats {
  sent: number;
  received: number;
  invalid: number;
  timeouts: number;
  retries: number;
}

type ResponseFor<T extends RequestBody['type']> = T extends 'get_info'
  ? DeviceInfoMsg
  : T extends 'ping'
    ? PongMsg
    : T extends 'get_diagnostics'
      ? DiagnosticsMsg
      : T extends 'rx_probe'
        ? RxProbeResultMsg
        : T extends 'loopback_test'
          ? LoopbackResultMsg
      : T extends 'list_stored'
        ? StoredListMsg
        : T extends 'get_config' | 'set_config' | 'reset_config'
          ? ConfigMsg
          : AckMsg;

export class DeviceClient {
  private assembler = new LineAssembler();
  private pending = new Map<string, Pending>();
  private txWaiters = new Map<string, Pending>();
  private events = new Emitter<DeviceMessage>();
  private subs: Unsubscribe[] = [];
  private seq = 0;
  private readonly session = Math.random().toString(36).slice(2, 6);
  readonly stats: ClientStats = { sent: 0, received: 0, invalid: 0, timeouts: 0, retries: 0 };

  constructor(private readonly transport: Transport) {
    this.subs.push(transport.onData((c) => this.onChunk(c)));
    this.subs.push(transport.onDisconnect(() => this.failAll(new DeviceError('disconnected', 'Device disconnected'))));
  }

  /** Subscribe to every valid inbound message (responses and events). */
  onMessage(cb: (m: DeviceMessage) => void): Unsubscribe {
    return this.events.on(cb);
  }

  dispose() {
    this.subs.forEach((u) => u());
    this.failAll(new DeviceError('disconnected', 'Client disposed'));
    this.events.clear();
  }

  /** Call when the link is (re)established so stale partial frames are dropped. */
  resetStream() {
    this.assembler.reset();
  }

  failAll(err: Error) {
    for (const map of [this.pending, this.txWaiters]) {
      for (const [, p] of map) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      map.clear();
    }
    this.assembler.reset();
  }

  // ------------------------------------------------------------ high level API

  getInfo() {
    return this.request({ type: 'get_info' }, { retries: 2 });
  }
  ping(echo?: string | number) {
    return this.request({ type: 'ping', echo }, { retries: 0, timeoutMs: 3000 });
  }
  getDiagnostics(logLines = 20) {
    return this.request({ type: 'get_diagnostics', logLines }, { retries: 1 });
  }
  /** Watches the receiver DATA pin for raw activity (wiring / power check). */
  probeReceiver(durationMs = 500) {
    return this.request({ type: 'rx_probe', durationMs }, { retries: 0, timeoutMs: durationMs + 4000 });
  }
  /** Self-test: device sends a test code on its TX and decodes it on its RX. */
  loopbackTest() {
    return this.request({ type: 'loopback_test' }, { retries: 0, timeoutMs: 8000 });
  }
  startLearning(opts: { timeoutMs: number; single: boolean; includeTimings: boolean }) {
    return this.request({ type: 'learn_start', ...opts }, { retries: 1 });
  }
  stopLearning() {
    return this.request({ type: 'learn_stop' }, { retries: 1 });
  }
  listStored() {
    return this.request({ type: 'list_stored' }, { retries: 1 });
  }
  storeSignal(name: string, signal: WireSignalInput, slot?: number) {
    return this.request({ type: 'store_signal', name, signal, slot }, { retries: 1 });
  }
  deleteStored(slot: number) {
    return this.request({ type: 'delete_stored', slot }, { retries: 1 });
  }
  clearStored() {
    return this.request({ type: 'clear_stored' }, { retries: 1 });
  }
  getConfig() {
    return this.request({ type: 'get_config' }, { retries: 1 });
  }
  setConfig(config: ConfigPatch) {
    return this.request({ type: 'set_config', config }, { retries: 1 });
  }
  reboot() {
    return this.request({ type: 'reboot' }, { retries: 0 });
  }

  /**
   * Sends a signal and resolves when the device reports `tx_done`.
   * Two phases: `ack` (accepted, rate limits passed) then `tx_done`.
   */
  async transmit(signal: WireSignalInput): Promise<{ ack: AckMsg; done: TxDoneMsg }> {
    const id = this.nextId();
    // Register before sending: tx_done may arrive right after the ack.
    let doneResolve!: (m: DeviceMessage) => void;
    let doneReject!: (e: Error) => void;
    const done = new Promise<DeviceMessage>((res, rej) => {
      doneResolve = res;
      doneReject = rej;
    });
    done.catch(() => undefined); // handled below
    const waiter: Pending = { resolve: doneResolve, reject: doneReject, timer: setTimeout(() => undefined, 0) };
    this.txWaiters.set(id, waiter);

    let ack: AckMsg;
    try {
      ack = (await this.requestWithId(id, { type: 'transmit', signal }, { retries: 1 })) as AckMsg;
    } catch (e) {
      this.txWaiters.delete(id);
      throw e;
    }
    clearTimeout(waiter.timer);
    waiter.timer = setTimeout(() => {
      if (this.txWaiters.delete(id)) {
        this.stats.timeouts++;
        doneReject(new DeviceError('timeout', 'No transmission confirmation from device'));
      }
    }, (ack.estimatedAirtimeMs ?? 0) + TX_DONE_MARGIN_MS);

    const msg = (await done) as TxDoneMsg;
    if (!msg.ok) {
      throw new DeviceError(msg.error?.code ?? 'tx_failed', msg.error?.message ?? 'Transmission failed', msg.error?.retryAfterMs);
    }
    return { ack, done: msg };
  }

  // ------------------------------------------------------------ core

  request<B extends RequestBody>(body: B, opts: RequestOptions = {}): Promise<ResponseFor<B['type']>> {
    return this.requestWithId(this.nextId(), body, opts) as Promise<ResponseFor<B['type']>>;
  }

  private async requestWithId(id: string, body: RequestBody, opts: RequestOptions): Promise<DeviceMessage> {
    const attempts = 1 + (opts.retries ?? 0);
    let lastErr: Error | null = null;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) this.stats.retries++;
      try {
        return await this.sendOnce(id, body, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      } catch (e) {
        lastErr = e as Error;
        if (!(e instanceof DeviceError) || e.code !== 'timeout') throw e;
      }
    }
    throw lastErr ?? new DeviceError('timeout', 'Request timed out');
  }

  private sendOnce(id: string, body: RequestBody, timeoutMs: number): Promise<DeviceMessage> {
    if (!this.transport.isConnected()) return Promise.reject(new DeviceError('disconnected', 'Not connected'));
    const bytes = encodeMessage({ v: PROTOCOL_VERSION, id, ...body });
    return new Promise<DeviceMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.get(id)?.timer === timer) this.pending.delete(id);
        this.stats.timeouts++;
        reject(new DeviceError('timeout', `No response to ${body.type}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.stats.sent++;
      this.transport.write(bytes).catch((e: Error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new DeviceError('write_failed', e?.message ?? 'BLE write failed'));
      });
    });
  }

  private nextId() {
    this.seq = (this.seq + 1) % 1_000_000;
    return `${this.session}-${this.seq}`;
  }

  private onChunk(chunk: Uint8Array) {
    const { lines, overflowed } = this.assembler.push(chunk);
    this.stats.invalid += overflowed;
    for (const line of lines) {
      const parsed = parseDeviceMessage(line);
      if (!parsed.ok) {
        this.stats.invalid++;
        continue;
      }
      this.stats.received++;
      this.dispatch(parsed.message);
    }
  }

  private dispatch(msg: DeviceMessage) {
    const id = msg.id;
    if (id) {
      if (msg.type === 'tx_done') {
        const w = this.txWaiters.get(id);
        if (w) {
          clearTimeout(w.timer);
          this.txWaiters.delete(id);
          w.resolve(msg);
        }
      } else {
        const p = this.pending.get(id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(id);
          if (msg.type === 'error') {
            const e = msg as ErrorMsg;
            p.reject(new DeviceError(e.code, e.message, e.retryAfterMs));
            // A rejected transmit will never produce tx_done.
            const w = this.txWaiters.get(id);
            if (w) {
              clearTimeout(w.timer);
              this.txWaiters.delete(id);
            }
          } else p.resolve(msg);
        }
      }
    }
    this.events.emit(msg);
  }
}
