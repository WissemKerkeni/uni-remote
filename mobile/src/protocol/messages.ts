// Typed message catalogue. Source of truth: docs/BLE_PROTOCOL.md.
import type { RfSignal } from '../domain/types';

// ---------------------------------------------------------------- requests

export type RequestBody =
  | { type: 'get_info' }
  | { type: 'ping'; echo?: string | number }
  | { type: 'get_diagnostics'; logLines?: number }
  | { type: 'rx_probe'; durationMs?: number }
  | { type: 'loopback_test'; signal?: WireSignalInput }
  | { type: 'learn_start'; timeoutMs?: number; single?: boolean; includeTimings?: boolean }
  | { type: 'learn_stop' }
  | { type: 'transmit'; signal: WireSignalInput }
  | { type: 'transmit_stored'; slot: number }
  | { type: 'store_signal'; slot?: number; name: string; signal: WireSignalInput }
  | { type: 'list_stored' }
  | { type: 'delete_stored'; slot: number }
  | { type: 'clear_stored' }
  | { type: 'get_config' }
  | { type: 'set_config'; config: ConfigPatch }
  | { type: 'reset_config' }
  | { type: 'reboot' };

export type RequestType = RequestBody['type'];
export type Request = RequestBody & { v: number; id: string };

export interface WireSignalInput {
  protocol: number;
  bitLength: number;
  value: string;
  pulseLength?: number;
  repeat?: number;
}

export interface ConfigPatch {
  rxPin?: number;
  txPin?: number;
  ledPin?: number;
  rxTolerance?: number;
  defaultRepeat?: number;
}

// ---------------------------------------------------------------- device messages

interface Base {
  v?: number;
  id?: string;
}

export interface ProtocolInfo {
  id: number;
  name: string;
  pulseLength: number;
}

export interface DeviceInfoMsg extends Base {
  type: 'device_info';
  name: string;
  firmwareVersion: string;
  protocolVersion: number;
  target: string;
  chipModel: string;
  chipRevision: number;
  cpuCores: number;
  flashSize: number;
  bleAddress: string;
  sdk: string;
  uptimeMs: number;
  radio: {
    frequencyMHz: number;
    frequencySource: 'nominal' | 'measured';
    modulation: string;
    rxReady: boolean;
    txReady: boolean;
    rxPin: number;
    txPin: number;
  };
  capabilities: {
    maxMessageBytes: number;
    maxRepeat: number;
    maxBitLength: number;
    storeCapacity: number;
    rawReplay: boolean;
    rollingCode: boolean;
    protocols: ProtocolInfo[];
  };
}

export interface PongMsg extends Base {
  type: 'pong';
  uptimeMs: number;
  echo?: unknown;
}

export interface DiagnosticsMsg extends Base {
  type: 'diagnostics';
  uptimeMs: number;
  bootCount: number;
  resetReason: string;
  freeHeap: number;
  minFreeHeap: number;
  cpuMhz: number;
  counters: Record<string, number>;
  lastError?: string;
  log?: { ms: number; msg: string }[];
  ble: { connected: boolean; subscribed: boolean; mtu: number };
  rf: { rxReady: boolean; txReady: boolean; learning: boolean; dutyBudgetMs: number; dutyBudgetMaxMs: number };
  store: { count: number; capacity: number };
}

export type ProbeVerdict = 'active' | 'quiet' | 'no_activity' | 'floating' | 'stuck_high';

export interface RxProbeResultMsg extends Base {
  type: 'rx_probe_result';
  rxPin: number;
  durationMs: number;
  edges: number;
  edgesPerSecond: number;
  highRatio: number;
  verdict: ProbeVerdict;
}

export interface LoopbackResultMsg extends Base {
  type: 'loopback_result';
  match: boolean;
  received: boolean;
  framesDecoded: number;
  sent: WireSignal;
  got?: WireSignal;
}

export interface AckMsg extends Base {
  type: 'ack';
  ok: true;
  slot?: number;
  estimatedAirtimeMs?: number;
  wasLearning?: boolean;
}

export interface ErrorMsg extends Base {
  type: 'error';
  code: string;
  message: string;
  retryAfterMs?: number;
}

export type LearnEndReason = 'timeout' | 'captured' | 'stopped' | 'restarted' | 'disconnected';

export interface LearnStateMsg extends Base {
  type: 'learn_state';
  active: boolean;
  requestId?: string;
  timeoutMs?: number;
  single?: boolean;
  reason?: LearnEndReason;
}

export interface WireSignal extends Required<WireSignalInput> {
  protocolName: string;
}

export interface SignalReceivedMsg extends Base {
  type: 'signal_received';
  requestId?: string;
  signal: WireSignal;
  frames: number;
  durationMs: number;
  frequencyMHz: number;
  frequencySource: 'nominal' | 'measured';
  modulation: string;
  encoding: string;
  decoded: { hex: string; binary: string; triState?: string };
  timings?: number[];
}

export interface TxDoneMsg extends Base {
  type: 'tx_done';
  ok: boolean;
  durationMs: number;
  repeat: number;
  error?: { code: string; message: string; retryAfterMs?: number };
}

export interface StoredItem {
  slot: number;
  name: string;
  signal: WireSignal;
}

export interface StoredListMsg extends Base {
  type: 'stored_list';
  capacity: number;
  count: number;
  items: StoredItem[];
}

export interface DeviceConfig {
  rxPin: number;
  txPin: number;
  ledPin: number;
  rxTolerance: number;
  defaultRepeat: number;
  rebootRequired: boolean;
  pending?: Partial<DeviceConfig>;
  allowedRxPins: number[];
  allowedTxPins: number[];
}

export interface ConfigMsg extends Base {
  type: 'config';
  config: DeviceConfig;
}

export type DeviceMessage =
  | DeviceInfoMsg
  | PongMsg
  | DiagnosticsMsg
  | RxProbeResultMsg
  | LoopbackResultMsg
  | AckMsg
  | ErrorMsg
  | LearnStateMsg
  | SignalReceivedMsg
  | TxDoneMsg
  | StoredListMsg
  | ConfigMsg;

export type DeviceMessageType = DeviceMessage['type'];

export function toWireSignal(s: RfSignal): WireSignalInput {
  return {
    protocol: s.protocol,
    bitLength: s.bitLength,
    value: s.value,
    pulseLength: s.pulseLength,
    repeat: s.repeat,
  };
}
