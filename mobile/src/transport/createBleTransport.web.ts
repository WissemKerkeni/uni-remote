import type { Transport } from './Transport';

// react-native-ble-plx has no web implementation; the app falls back to the simulator.
export function createBleTransport(): Transport | null {
  return null;
}
