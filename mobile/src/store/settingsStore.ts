import { Platform } from 'react-native';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { persistStorage } from './storage';

export type TransportMode = 'ble' | 'mock';

interface SettingsState {
  transportMode: TransportMode;
  lastDeviceId: string | null;
  lastDeviceName: string | null;
  autoReconnect: boolean;
  learnTimeoutSec: number;
  learnSingle: boolean;
  includeTimings: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      // Web has no BLE: default to the simulator there.
      transportMode: Platform.OS === 'web' ? 'mock' : 'ble',
      lastDeviceId: null,
      lastDeviceName: null,
      autoReconnect: true,
      learnTimeoutSec: 30,
      learnSingle: true,
      includeTimings: true,
      set: (patch) => set(patch),
    }),
    { name: 'uniremote.settings.v1', storage: persistStorage, version: 1 },
  ),
);
