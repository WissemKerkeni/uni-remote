// Newline-delimited JSON framing over a byte stream (BLE notifications/writes).
// Compact JSON never contains a raw '\n' (it is escaped inside strings), so
// 0x0A is an unambiguous message terminator.
import { utf8Decode, utf8Encode } from './bytes';
import { MAX_MESSAGE_BYTES } from './constants';

const NEWLINE = 0x0a;
const CR = 0x0d;

export function encodeMessage(message: object): Uint8Array {
  const bytes = utf8Encode(JSON.stringify(message) + '\n');
  if (bytes.length - 1 > MAX_MESSAGE_BYTES) {
    throw new Error(`Message too large (${bytes.length} bytes, max ${MAX_MESSAGE_BYTES})`);
  }
  return bytes;
}

export function splitChunks(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  const size = Math.max(1, Math.floor(chunkSize));
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size));
  return chunks;
}

export interface PushResult {
  lines: string[];
  overflowed: number; // messages discarded for exceeding the limit
}

export class LineAssembler {
  private buf: number[] = [];
  private discarding = false;

  constructor(private readonly maxBytes = MAX_MESSAGE_BYTES) {}

  push(chunk: Uint8Array): PushResult {
    const lines: string[] = [];
    let overflowed = 0;
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      if (b === NEWLINE) {
        if (this.discarding) this.discarding = false;
        else if (this.buf.length) lines.push(utf8Decode(Uint8Array.from(this.buf)));
        this.buf = [];
        continue;
      }
      if (b === CR || this.discarding) continue;
      if (this.buf.length >= this.maxBytes) {
        this.discarding = true;
        this.buf = [];
        overflowed++;
        continue;
      }
      this.buf.push(b);
    }
    return { lines, overflowed };
  }

  reset() {
    this.buf = [];
    this.discarding = false;
  }
}
