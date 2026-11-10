// Must match firmware/include/config.h and docs/BLE_PROTOCOL.md.
export const PROTOCOL_VERSION = 1;

export const BLE_UUIDS = {
  service: '6e7a0001-3c1b-4b8e-9d2f-5a4c1e0b7f30',
  rx: '6e7a0002-3c1b-4b8e-9d2f-5a4c1e0b7f30', // app -> device (write)
  tx: '6e7a0003-3c1b-4b8e-9d2f-5a4c1e0b7f30', // device -> app (notify)
} as const;

export const DEVICE_NAME_PREFIX = 'UniRemote';
export const MAX_MESSAGE_BYTES = 4096;
export const PREFERRED_MTU = 247;

export const DEFAULT_TIMEOUT_MS = 4000;
export const TX_DONE_MARGIN_MS = 4000;
