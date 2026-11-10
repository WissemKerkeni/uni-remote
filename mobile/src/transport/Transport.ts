// Byte-level link to a UniRemote device. Implementations: BLE (real
// hardware) and Mock (in-app simulator for demo mode and tests).
// The DeviceClient sits on top and knows nothing about BLE.

export type AdapterState = 'PoweredOn' | 'PoweredOff' | 'Unauthorized' | 'Unsupported' | 'Resetting' | 'Unknown';

export interface DiscoveredDevice {
  id: string;
  name: string;
  rssi: number | null;
}

export interface LinkInfo {
  deviceId: string;
  name: string;
  mtu: number;
}

export type Unsubscribe = () => void;

export interface Transport {
  readonly kind: 'ble' | 'mock';

  getAdapterState(): Promise<AdapterState>;
  onAdapterStateChange(cb: (s: AdapterState) => void): Unsubscribe;
  /** Requests runtime permissions (Android). Resolves false when denied. */
  requestPermissions(): Promise<boolean>;

  startScan(onDevice: (d: DiscoveredDevice) => void, onError: (e: Error) => void): Promise<void>;
  stopScan(): Promise<void>;

  connect(deviceId: string): Promise<LinkInfo>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  /** Writes a complete framed message. The transport splits it into MTU-sized chunks, in order. */
  write(bytes: Uint8Array): Promise<void>;
  onData(cb: (chunk: Uint8Array) => void): Unsubscribe;
  /** Fires on unexpected link loss (not after an explicit disconnect()). */
  onDisconnect(cb: (error?: Error) => void): Unsubscribe;

  destroy(): void;
}

export class Emitter<T> {
  private listeners = new Set<(v: T) => void>();
  on(cb: (v: T) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(v: T) {
    for (const l of [...this.listeners]) l(v);
  }
  clear() {
    this.listeners.clear();
  }
}
