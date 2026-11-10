// Live device/connection state (not persisted).
import { create } from 'zustand';

import type { Capture } from '../domain/types';
import type { DeviceConfig, DeviceInfoMsg, DiagnosticsMsg, LoopbackResultMsg, RxProbeResultMsg, StoredListMsg } from '../protocol/messages';
import type { AdapterState, DiscoveredDevice } from '../transport/Transport';

export type ConnectionStatus = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'reconnecting';

export type TxState = { state: 'sending' } | { state: 'ok'; at: number; durationMs: number } | { state: 'error'; at: number; message: string };

export interface PingStats {
  count: number;
  failures: number;
  minMs: number;
  avgMs: number;
  maxMs: number;
}

interface DeviceState {
  adapter: AdapterState;
  status: ConnectionStatus;
  deviceId: string | null;
  deviceName: string | null;
  mtu: number;
  discovered: DiscoveredDevice[];
  info: DeviceInfoMsg | null;
  diagnostics: DiagnosticsMsg | null;
  ping: PingStats | null;
  probe: RxProbeResultMsg | null;
  loopback: LoopbackResultMsg | null;
  config: DeviceConfig | null;
  stored: StoredListMsg | null;
  lastError: string | null;

  learning: { active: boolean; endsAt: number | null; requestId: string | null };
  captures: Capture[];

  tx: Record<string, TxState>; // keyed by button id / signal id

  patch: (p: Partial<DeviceState>) => void;
  addDiscovered: (d: DiscoveredDevice) => void;
  addCapture: (c: Capture) => void;
  removeCapture: (id: string) => void;
  clearCaptures: () => void;
  setTx: (key: string, s: TxState) => void;
}

export const useDevice = create<DeviceState>()((set) => ({
  adapter: 'Unknown',
  status: 'disconnected',
  deviceId: null,
  deviceName: null,
  mtu: 23,
  discovered: [],
  info: null,
  diagnostics: null,
  ping: null,
  probe: null,
  loopback: null,
  config: null,
  stored: null,
  lastError: null,
  learning: { active: false, endsAt: null, requestId: null },
  captures: [],
  tx: {},

  patch: (p) => set(p),
  addDiscovered: (d) =>
    set((s) => ({
      discovered: s.discovered.some((x) => x.id === d.id)
        ? s.discovered.map((x) => (x.id === d.id ? d : x))
        : [...s.discovered, d],
    })),
  addCapture: (c) => set((s) => ({ captures: [c, ...s.captures].slice(0, 50) })),
  removeCapture: (id) => set((s) => ({ captures: s.captures.filter((c) => c.id !== id) })),
  clearCaptures: () => set({ captures: [] }),
  setTx: (key, t) => set((s) => ({ tx: { ...s.tx, [key]: t } })),
}));
