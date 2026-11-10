// Application-level orchestration: owns the active transport + client and
// mirrors everything into the zustand stores the UI renders from.
import { protocolName } from '../domain/signal';
import type { Capture, RfSignal } from '../domain/types';
import { toWireSignal, type ConfigPatch, type DeviceMessage } from '../protocol/messages';
import { useDevice } from '../store/deviceStore';
import { useSettings, type TransportMode } from '../store/settingsStore';
import { uid } from '../store/storage';
import { createBleTransport } from '../transport/createBleTransport';
import { MockTransport } from '../transport/MockTransport';
import type { Transport, Unsubscribe } from '../transport/Transport';
import { DeviceClient, DeviceError } from './DeviceClient';

const SCAN_TIMEOUT_MS = 12000;
const RECONNECT_DELAYS_MS = [1000, 3000, 6000];

let transport: Transport | null = null;
let client: DeviceClient | null = null;
let mode: TransportMode | null = null;
let subs: Unsubscribe[] = [];
let scanTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const dev = () => useDevice.getState();

export function errorMessage(e: unknown): string {
  if (e instanceof DeviceError) {
    switch (e.code) {
      case 'timeout':
        return 'The device did not answer in time.';
      case 'disconnected':
        return 'Not connected to a device.';
      case 'rate_limited':
        return `Radio duty-cycle limit reached. Try again in ${Math.ceil((e.retryAfterMs ?? 1000) / 1000)} s.`;
      default:
        return e.message;
    }
  }
  return e instanceof Error ? e.message : String(e);
}

/** (Re)creates the transport for the selected mode. Safe to call repeatedly. */
export function initTransport(nextMode: TransportMode = useSettings.getState().transportMode) {
  if (transport && mode === nextMode) return;
  teardown();
  mode = nextMode;
  transport = nextMode === 'ble' ? createBleTransport() : new MockTransport();
  if (!transport) {
    // BLE unavailable on this platform (web): fall back to the simulator.
    mode = 'mock';
    transport = new MockTransport();
  }
  client = new DeviceClient(transport);
  subs.push(client.onMessage(onDeviceMessage));
  subs.push(transport.onAdapterStateChange((adapter) => dev().patch({ adapter })));
  subs.push(transport.onDisconnect((err) => onLinkLost(err)));
}

export function activeMode(): TransportMode | null {
  return mode;
}

function teardown() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (scanTimer) clearTimeout(scanTimer);
  subs.forEach((u) => u());
  subs = [];
  client?.dispose();
  transport?.destroy();
  client = null;
  transport = null;
  dev().patch({ status: 'disconnected', deviceId: null, deviceName: null, info: null, discovered: [], learning: { active: false, endsAt: null, requestId: null } });
}

export function getClient(): DeviceClient {
  if (!client) throw new DeviceError('disconnected', 'Not connected to a device.');
  return client;
}

// ------------------------------------------------------------------ scanning

export async function startScan() {
  initTransport();
  const t = transport!;
  dev().patch({ discovered: [], lastError: null });
  const granted = await t.requestPermissions();
  if (!granted) {
    dev().patch({ lastError: 'Bluetooth permission denied. Enable it in system settings.' });
    return;
  }
  const adapter = await t.getAdapterState();
  dev().patch({ adapter });
  if (adapter !== 'PoweredOn') {
    dev().patch({ lastError: adapter === 'PoweredOff' ? 'Bluetooth is turned off.' : `Bluetooth is ${adapter}.` });
    return;
  }
  if (dev().status === 'disconnected') dev().patch({ status: 'scanning' });
  await t.startScan(
    (d) => dev().addDiscovered(d),
    (e) => {
      dev().patch({ lastError: `Scan failed: ${e.message}` });
      void stopScan();
    },
  );
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => void stopScan(), SCAN_TIMEOUT_MS);
}

export async function stopScan() {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
  await transport?.stopScan().catch(() => undefined);
  if (dev().status === 'scanning') dev().patch({ status: 'disconnected' });
}

// ------------------------------------------------------------------ connection

export async function connect(deviceId: string, name?: string) {
  initTransport();
  await stopScan();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const reconnecting = dev().status === 'reconnecting';
  dev().patch({ status: reconnecting ? 'reconnecting' : 'connecting', lastError: null, deviceName: name ?? dev().deviceName });
  try {
    const link = await transport!.connect(deviceId);
    client!.resetStream();
    dev().patch({ status: 'connected', deviceId, deviceName: link.name, mtu: link.mtu });
    reconnectAttempt = 0;
    useSettings.getState().set({ lastDeviceId: deviceId, lastDeviceName: link.name });
    await refreshInfo();
  } catch (e) {
    dev().patch({ status: 'disconnected', lastError: `Connection failed: ${errorMessage(e)}` });
    throw e;
  }
}

export async function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectAttempt = RECONNECT_DELAYS_MS.length; // suppress auto-reconnect
  await transport?.disconnect();
  client?.failAll(new DeviceError('disconnected', 'Disconnected'));
  dev().patch({ status: 'disconnected', info: null, diagnostics: null, learning: { active: false, endsAt: null, requestId: null } });
}

function onLinkLost(err?: Error) {
  const { deviceId } = dev();
  dev().patch({
    status: 'disconnected',
    lastError: err ? `Connection lost: ${err.message}` : 'Connection lost',
    learning: { active: false, endsAt: null, requestId: null },
  });
  if (!deviceId || !useSettings.getState().autoReconnect) return;
  if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) return;
  const delay = RECONNECT_DELAYS_MS[reconnectAttempt++];
  dev().patch({ status: 'reconnecting' });
  reconnectTimer = setTimeout(() => {
    connect(deviceId).catch(() => onLinkLost(new Error('reconnect failed')));
  }, delay);
}

/** Connects to the last used device, if any (app start). */
export async function autoConnect() {
  const { lastDeviceId, lastDeviceName, autoReconnect } = useSettings.getState();
  if (!autoReconnect || !lastDeviceId) return;
  initTransport();
  const adapter = await transport!.getAdapterState();
  if (adapter !== 'PoweredOn') return;
  if (mode === 'ble' && !(await transport!.requestPermissions())) return;
  await connect(lastDeviceId, lastDeviceName ?? undefined).catch(() => undefined);
}

// ------------------------------------------------------------------ device queries

export async function refreshInfo() {
  const info = await getClient().getInfo();
  dev().patch({ info });
  return info;
}

export async function runDiagnostics(pings = 5) {
  const c = getClient();
  const times: number[] = [];
  let failures = 0;
  for (let i = 0; i < pings; i++) {
    const t0 = Date.now();
    try {
      await c.ping(i);
      times.push(Date.now() - t0);
    } catch {
      failures++;
    }
  }
  const ping = {
    count: pings,
    failures,
    minMs: times.length ? Math.min(...times) : 0,
    maxMs: times.length ? Math.max(...times) : 0,
    avgMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
  };
  const diagnostics = await c.getDiagnostics(30);
  dev().patch({ ping, diagnostics });
  return { ping, diagnostics, client: { ...c.stats } };
}

export async function probeReceiver(durationMs = 500) {
  const probe = await getClient().probeReceiver(durationMs);
  dev().patch({ probe });
  return probe;
}

export async function loopbackTest() {
  const loopback = await getClient().loopbackTest();
  dev().patch({ loopback });
  return loopback;
}

export async function loadConfig() {
  const { config } = await getClient().getConfig();
  dev().patch({ config });
  return config;
}

export async function saveConfig(patch: ConfigPatch) {
  const { config } = await getClient().setConfig(patch);
  dev().patch({ config });
  return config;
}

export async function rebootDevice() {
  await getClient().reboot();
}

export async function loadStored() {
  const stored = await getClient().listStored();
  dev().patch({ stored });
  return stored;
}

export async function backupSignalToDevice(name: string, signal: RfSignal) {
  const ack = await getClient().storeSignal(name.slice(0, 32), toWireSignal(signal));
  await loadStored();
  return ack.slot;
}

export async function deleteStoredOnDevice(slot: number) {
  await getClient().deleteStored(slot);
  await loadStored();
}

// ------------------------------------------------------------------ learning

export async function startLearning() {
  const { learnTimeoutSec, learnSingle, includeTimings } = useSettings.getState();
  const timeoutMs = learnTimeoutSec * 1000;
  await getClient().startLearning({ timeoutMs, single: learnSingle, includeTimings });
  dev().patch({ learning: { active: true, endsAt: Date.now() + timeoutMs, requestId: null } });
}

export async function stopLearning() {
  await getClient().stopLearning();
  dev().patch({ learning: { active: false, endsAt: null, requestId: null } });
}

// ------------------------------------------------------------------ transmit

/** Sends a signal; `key` identifies the UI element showing the status. */
export async function transmit(key: string, signal: RfSignal) {
  dev().setTx(key, { state: 'sending' });
  try {
    const { done } = await getClient().transmit(toWireSignal(signal));
    dev().setTx(key, { state: 'ok', at: Date.now(), durationMs: done.durationMs });
    return done;
  } catch (e) {
    dev().setTx(key, { state: 'error', at: Date.now(), message: errorMessage(e) });
    throw e;
  }
}

// ------------------------------------------------------------------ events

function onDeviceMessage(m: DeviceMessage) {
  switch (m.type) {
    case 'learn_state':
      dev().patch({
        learning: m.active
          ? { active: true, endsAt: Date.now() + (m.timeoutMs ?? 30000), requestId: m.requestId ?? null }
          : { active: false, endsAt: null, requestId: null },
      });
      break;
    case 'signal_received': {
      const capture: Capture = {
        id: uid('c_'),
        signal: {
          protocol: m.signal.protocol,
          protocolName: m.signal.protocolName ?? protocolName(m.signal.protocol),
          bitLength: m.signal.bitLength,
          value: m.signal.value,
          pulseLength: m.signal.pulseLength,
          repeat: m.signal.repeat,
        },
        frames: m.frames,
        durationMs: m.durationMs,
        decoded: m.decoded,
        frequencyMHz: m.frequencyMHz,
        frequencySource: m.frequencySource,
        modulation: m.modulation,
        timings: m.timings,
        receivedAt: Date.now(),
      };
      dev().addCapture(capture);
      break;
    }
    case 'error':
      if (!m.id) dev().patch({ lastError: `Device: ${m.message}` });
      break;
  }
}
