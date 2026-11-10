// Signal rules mirrored from firmware/src/signal_model.cpp so the app can
// validate imports and the simulator behaves like the real device.
import type { RfSignal } from './types';

export interface ProtocolTiming {
  id: number;
  name: string;
  pulse: number;
  sync: [number, number];
  zero: [number, number];
  one: [number, number];
  inverted: boolean;
}

export const PROTOCOLS: ProtocolTiming[] = [
  { id: 1, name: 'PT2262/EV1527', pulse: 350, sync: [1, 31], zero: [1, 3], one: [3, 1], inverted: false },
  { id: 2, name: 'rc-switch #2', pulse: 650, sync: [1, 10], zero: [1, 2], one: [2, 1], inverted: false },
  { id: 3, name: 'rc-switch #3', pulse: 100, sync: [30, 71], zero: [4, 11], one: [9, 6], inverted: false },
  { id: 4, name: 'rc-switch #4', pulse: 380, sync: [1, 6], zero: [1, 3], one: [3, 1], inverted: false },
  { id: 5, name: 'rc-switch #5', pulse: 500, sync: [6, 14], zero: [1, 2], one: [2, 1], inverted: false },
  { id: 6, name: 'HT6P20B', pulse: 450, sync: [23, 1], zero: [1, 2], one: [2, 1], inverted: true },
  { id: 7, name: 'HS2303-PT', pulse: 150, sync: [2, 62], zero: [1, 6], one: [6, 1], inverted: false },
  { id: 8, name: 'Conrad RS-200 RX', pulse: 200, sync: [3, 130], zero: [7, 16], one: [3, 16], inverted: false },
  { id: 9, name: 'Conrad RS-200 TX', pulse: 200, sync: [130, 7], zero: [16, 7], one: [16, 3], inverted: true },
  { id: 10, name: '1ByOne doorbell', pulse: 365, sync: [18, 1], zero: [3, 1], one: [1, 3], inverted: true },
  { id: 11, name: 'HT12E', pulse: 270, sync: [36, 1], zero: [1, 2], one: [2, 1], inverted: true },
  { id: 12, name: 'SM5212', pulse: 320, sync: [36, 1], zero: [1, 2], one: [2, 1], inverted: true },
];

export const LIMITS = {
  maxBitLength: 32,
  minPulse: 50,
  maxPulse: 2000,
  maxRepeat: 20,
  maxAirtimeMs: 2500,
  defaultRepeat: 10,
} as const;

export function protocolInfo(id: number): ProtocolTiming | undefined {
  return PROTOCOLS.find((p) => p.id === id);
}

export function protocolName(id: number): string {
  return protocolInfo(id)?.name ?? `protocol ${id}`;
}

/** Returns an error message, or null when the signal is valid for transmission. */
export function validateSignal(s: Partial<RfSignal> | null | undefined): string | null {
  if (!s || typeof s !== 'object') return 'missing signal';
  if (!Number.isInteger(s.protocol) || !protocolInfo(s.protocol as number)) return 'unsupported protocol';
  if (!Number.isInteger(s.bitLength) || (s.bitLength as number) < 1 || (s.bitLength as number) > LIMITS.maxBitLength)
    return `bitLength must be 1..${LIMITS.maxBitLength}`;
  if (typeof s.value !== 'string' || !/^\d{1,10}$/.test(s.value)) return 'value must be a decimal string';
  const v = BigInt(s.value);
  if (v >= 1n << BigInt(s.bitLength as number)) return `value does not fit in ${s.bitLength} bits`;
  if (!Number.isInteger(s.pulseLength)) return 'pulseLength must be an integer';
  const p = s.pulseLength as number;
  if (p !== 0 && (p < LIMITS.minPulse || p > LIMITS.maxPulse))
    return `pulseLength must be ${LIMITS.minPulse}..${LIMITS.maxPulse} us`;
  if (!Number.isInteger(s.repeat) || (s.repeat as number) < 1 || (s.repeat as number) > LIMITS.maxRepeat)
    return `repeat must be 1..${LIMITS.maxRepeat}`;
  if (estimateAirtimeMs(s as RfSignal) > LIMITS.maxAirtimeMs) return 'frame too long, reduce repeat';
  return null;
}

export function estimateAirtimeMs(s: RfSignal): number {
  const t = protocolInfo(s.protocol);
  if (!t) return 0;
  const pulse = s.pulseLength || t.pulse;
  const perBit = Math.max(t.zero[0] + t.zero[1], t.one[0] + t.one[1]);
  const perFrameUs = (perBit * s.bitLength + t.sync[0] + t.sync[1]) * pulse;
  return Math.ceil((perFrameUs * s.repeat) / 1000);
}

export function toHex(s: RfSignal): string {
  const digits = Math.ceil(s.bitLength / 4);
  return '0x' + BigInt(s.value).toString(16).toUpperCase().padStart(digits, '0');
}

export function toBinary(s: RfSignal): string {
  return BigInt(s.value).toString(2).padStart(s.bitLength, '0');
}

/** PT2262 tri-state view (00='0', 11='1', 01='F'); undefined when not applicable. */
export function toTriState(s: RfSignal): string | undefined {
  if (s.protocol !== 1 || s.bitLength % 2 !== 0) return undefined;
  const bin = toBinary(s);
  let out = '';
  for (let i = 0; i < bin.length; i += 2) {
    const pair = bin.slice(i, i + 2);
    if (pair === '00') out += '0';
    else if (pair === '11') out += '1';
    else if (pair === '01') out += 'F';
    else return undefined;
  }
  return out;
}

export function signalKey(s: RfSignal): string {
  return `${s.protocol}:${s.bitLength}:${s.value}`;
}

export function describeSignal(s: RfSignal): string {
  return `${protocolName(s.protocol)} · ${s.bitLength} bit · ${toHex(s)}`;
}
