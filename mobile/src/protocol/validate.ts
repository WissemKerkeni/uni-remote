// Runtime validation of messages coming from the device. Anything that does
// not match the expected shape is dropped (and counted) instead of crashing UI.
import type { DeviceMessage, DeviceMessageType } from './messages';
import { PROTOCOL_VERSION } from './constants';

const KNOWN: ReadonlySet<DeviceMessageType> = new Set<DeviceMessageType>([
  'device_info',
  'pong',
  'diagnostics',
  'rx_probe_result',
  'loopback_result',
  'ack',
  'error',
  'learn_state',
  'signal_received',
  'tx_done',
  'stored_list',
  'config',
]);

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

function isWireSignal(x: unknown): boolean {
  return (
    isObj(x) &&
    isNum(x.protocol) &&
    isNum(x.bitLength) &&
    isStr(x.value) &&
    /^\d+$/.test(x.value) &&
    isNum(x.pulseLength) &&
    isNum(x.repeat)
  );
}

export type ParseResult = { ok: true; message: DeviceMessage } | { ok: false; reason: string };

export function parseDeviceMessage(line: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, reason: 'invalid JSON' };
  }
  if (!isObj(raw)) return { ok: false, reason: 'not an object' };
  if (raw.v !== undefined && raw.v !== PROTOCOL_VERSION) return { ok: false, reason: `protocol v${raw.v}` };
  if (!isStr(raw.type) || !KNOWN.has(raw.type as DeviceMessageType))
    return { ok: false, reason: `unknown type ${String(raw.type)}` };
  if (raw.id !== undefined && !isStr(raw.id)) return { ok: false, reason: 'bad id' };

  switch (raw.type) {
    case 'error':
      if (!isStr(raw.code) || !isStr(raw.message)) return { ok: false, reason: 'bad error' };
      break;
    case 'signal_received':
      if (!isWireSignal(raw.signal) || !isObj(raw.decoded) || !isNum(raw.frames))
        return { ok: false, reason: 'bad signal_received' };
      if (raw.timings !== undefined && !(Array.isArray(raw.timings) && raw.timings.every(isNum)))
        return { ok: false, reason: 'bad timings' };
      break;
    case 'tx_done':
      if (typeof raw.ok !== 'boolean') return { ok: false, reason: 'bad tx_done' };
      break;
    case 'learn_state':
      if (typeof raw.active !== 'boolean') return { ok: false, reason: 'bad learn_state' };
      break;
    case 'device_info':
      if (!isStr(raw.firmwareVersion) || !isObj(raw.radio) || !isObj(raw.capabilities))
        return { ok: false, reason: 'bad device_info' };
      break;
    case 'stored_list':
      if (!Array.isArray(raw.items)) return { ok: false, reason: 'bad stored_list' };
      break;
    case 'rx_probe_result':
      if (!isNum(raw.edges) || !isStr(raw.verdict)) return { ok: false, reason: 'bad rx_probe_result' };
      break;
    case 'loopback_result':
      if (typeof raw.match !== 'boolean' || !isWireSignal(raw.sent)) return { ok: false, reason: 'bad loopback_result' };
      break;
    case 'config':
      if (!isObj(raw.config)) return { ok: false, reason: 'bad config' };
      break;
  }
  return { ok: true, message: raw as unknown as DeviceMessage };
}
