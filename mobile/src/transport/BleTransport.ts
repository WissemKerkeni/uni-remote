// react-native-ble-plx implementation. Requires a development build
// (`npx expo run:android` / EAS) - it does not work in Expo Go or on web.
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Device, type Subscription, State } from 'react-native-ble-plx';

import { base64ToBytes, bytesToBase64 } from '../protocol/bytes';
import { BLE_UUIDS, DEVICE_NAME_PREFIX, PREFERRED_MTU } from '../protocol/constants';
import { splitChunks } from '../protocol/framing';
import { type AdapterState, type DiscoveredDevice, Emitter, type LinkInfo, type Transport } from './Transport';

const ATT_HEADER = 3;

export class BleTransport implements Transport {
  readonly kind = 'ble' as const;
  private manager = new BleManager();
  private device: Device | null = null;
  private mtu = 23;
  private notifySub: Subscription | null = null;
  private disconnectSub: Subscription | null = null;
  private explicitDisconnect = false;
  private writeQueue: Promise<void> = Promise.resolve();
  private data = new Emitter<Uint8Array>();
  private lost = new Emitter<Error | undefined>();

  async getAdapterState(): Promise<AdapterState> {
    return mapState(await this.manager.state());
  }

  onAdapterStateChange(cb: (s: AdapterState) => void) {
    const sub = this.manager.onStateChange((s) => cb(mapState(s)), true);
    return () => sub.remove();
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true; // iOS prompts on first use
    const api = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
    if (api >= 31) {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      return Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
    }
    // Android <= 11: BLE scanning needs location permission.
    const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    return res === PermissionsAndroid.RESULTS.GRANTED;
  }

  async startScan(onDevice: (d: DiscoveredDevice) => void, onError: (e: Error) => void) {
    await this.manager.startDeviceScan([BLE_UUIDS.service], { allowDuplicates: false }, (error, dev) => {
      if (error) {
        onError(error);
        return;
      }
      if (!dev) return;
      const name = dev.localName ?? dev.name ?? '';
      // Service UUID filter is authoritative; the name check only helps when
      // the platform drops the UUID from cached advertisements.
      const matches = dev.serviceUUIDs?.some((u) => u.toLowerCase() === BLE_UUIDS.service) || name.startsWith(DEVICE_NAME_PREFIX);
      if (matches) onDevice({ id: dev.id, name: name || 'UniRemote', rssi: dev.rssi ?? null });
    });
  }

  async stopScan() {
    await this.manager.stopDeviceScan();
  }

  async connect(deviceId: string): Promise<LinkInfo> {
    await this.stopScan().catch(() => undefined);
    this.explicitDisconnect = false;
    let dev = await this.manager.connectToDevice(deviceId, {
      timeout: 10000,
      requestMTU: Platform.OS === 'android' ? PREFERRED_MTU : undefined,
    });
    try {
      dev = await dev.discoverAllServicesAndCharacteristics();
      if (Platform.OS === 'android' && (dev.mtu ?? 23) < PREFERRED_MTU) {
        dev = await dev.requestMTU(PREFERRED_MTU).catch(() => dev);
      }
      const chars = await dev.characteristicsForService(BLE_UUIDS.service);
      const uuids = chars.map((c) => c.uuid.toLowerCase());
      if (!uuids.includes(BLE_UUIDS.rx) || !uuids.includes(BLE_UUIDS.tx)) {
        throw new Error('Device does not expose the UniRemote GATT service');
      }
    } catch (e) {
      await this.manager.cancelDeviceConnection(deviceId).catch(() => undefined);
      throw e;
    }

    this.device = dev;
    this.mtu = dev.mtu ?? 23;
    this.notifySub = dev.monitorCharacteristicForService(BLE_UUIDS.service, BLE_UUIDS.tx, (error, ch) => {
      if (error) return; // link loss is reported by onDeviceDisconnected
      if (ch?.value) this.data.emit(base64ToBytes(ch.value));
    });
    this.disconnectSub = this.manager.onDeviceDisconnected(deviceId, (error) => {
      this.cleanup();
      if (!this.explicitDisconnect) this.lost.emit(error ?? new Error('Connection lost'));
    });
    return { deviceId, name: dev.localName ?? dev.name ?? 'UniRemote', mtu: this.mtu };
  }

  async disconnect() {
    const dev = this.device;
    this.explicitDisconnect = true;
    this.cleanup();
    if (dev) await this.manager.cancelDeviceConnection(dev.id).catch(() => undefined);
  }

  isConnected() {
    return this.device !== null;
  }

  write(bytes: Uint8Array): Promise<void> {
    // Serialize writes so chunks of different messages never interleave.
    const run = async () => {
      const dev = this.device;
      if (!dev) throw new Error('Not connected');
      const chunkSize = Math.max(20, Math.min(this.mtu - ATT_HEADER, 512));
      for (const chunk of splitChunks(bytes, chunkSize)) {
        // Write-with-response gives ordering and flow control per chunk.
        await dev.writeCharacteristicWithResponseForService(BLE_UUIDS.service, BLE_UUIDS.rx, bytesToBase64(chunk));
      }
    };
    const p = this.writeQueue.then(run, run);
    this.writeQueue = p.catch(() => undefined);
    return p;
  }

  onData(cb: (chunk: Uint8Array) => void) {
    return this.data.on(cb);
  }

  onDisconnect(cb: (error?: Error) => void) {
    return this.lost.on(cb);
  }

  destroy() {
    this.cleanup();
    this.data.clear();
    this.lost.clear();
    this.manager.destroy();
  }

  private cleanup() {
    this.notifySub?.remove();
    this.disconnectSub?.remove();
    this.notifySub = null;
    this.disconnectSub = null;
    this.device = null;
    this.mtu = 23;
  }
}

function mapState(s: State): AdapterState {
  switch (s) {
    case State.PoweredOn:
      return 'PoweredOn';
    case State.PoweredOff:
      return 'PoweredOff';
    case State.Unauthorized:
      return 'Unauthorized';
    case State.Unsupported:
      return 'Unsupported';
    case State.Resetting:
      return 'Resetting';
    default:
      return 'Unknown';
  }
}
