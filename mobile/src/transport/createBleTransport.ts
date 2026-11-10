import type { Transport } from './Transport';

// Native platforms: real BLE. (Web uses createBleTransport.web.ts.)
export function createBleTransport(): Transport | null {
  // Lazy require so the native module is only loaded when BLE is used.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BleTransport } = require('./BleTransport') as typeof import('./BleTransport');
  return new BleTransport();
}
