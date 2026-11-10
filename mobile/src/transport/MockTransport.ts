// Transport backed by the in-app MockDevice simulator.
import { MockDevice, type MockDeviceOptions } from './MockDevice';
import { type AdapterState, type DiscoveredDevice, Emitter, type LinkInfo, type Transport } from './Transport';

export const MOCK_DEVICE_ID = 'mock-uniremote';

export class MockTransport implements Transport {
  readonly kind = 'mock' as const;
  private device: MockDevice | null = null;
  private data = new Emitter<Uint8Array>();
  private lost = new Emitter<Error | undefined>();
  private scanTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: MockDeviceOptions = { latencyMs: 40, chunkSize: 20, autoCaptureDelayMs: 1800 }) {}

  async getAdapterState(): Promise<AdapterState> {
    return 'PoweredOn';
  }
  onAdapterStateChange(cb: (s: AdapterState) => void) {
    cb('PoweredOn');
    return () => undefined;
  }
  async requestPermissions() {
    return true;
  }

  async startScan(onDevice: (d: DiscoveredDevice) => void) {
    this.scanTimer = setTimeout(() => onDevice({ id: MOCK_DEVICE_ID, name: 'UniRemote-DEMO (simulator)', rssi: -48 }), 400);
  }
  async stopScan() {
    if (this.scanTimer) clearTimeout(this.scanTimer);
    this.scanTimer = null;
  }

  async connect(deviceId: string): Promise<LinkInfo> {
    if (deviceId !== MOCK_DEVICE_ID) throw new Error('Unknown simulated device');
    this.device?.shutdown();
    this.device = new MockDevice((chunk) => this.data.emit(chunk), this.options);
    return { deviceId, name: this.device.name, mtu: (this.options.chunkSize ?? 20) + 3 };
  }

  async disconnect() {
    this.device?.shutdown();
    this.device = null;
  }

  isConnected() {
    return this.device !== null;
  }

  async write(bytes: Uint8Array) {
    if (!this.device) throw new Error('Not connected');
    // Copy: the caller may reuse the buffer.
    this.device.receive(bytes.slice());
  }

  onData(cb: (chunk: Uint8Array) => void) {
    return this.data.on(cb);
  }
  onDisconnect(cb: (error?: Error) => void) {
    return this.lost.on(cb);
  }

  /** Test helper: drop the link as if the device went out of range. */
  simulateLinkLoss() {
    this.device?.shutdown();
    this.device = null;
    this.lost.emit(new Error('Simulated link loss'));
  }

  /** Test helper. */
  get simulator(): MockDevice | null {
    return this.device;
  }

  destroy() {
    void this.disconnect();
    this.data.clear();
    this.lost.clear();
  }
}
