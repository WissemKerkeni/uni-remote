import { base64ToBytes, bytesToBase64, utf8Decode, utf8Encode } from '../protocol/bytes';
import { encodeMessage, LineAssembler, splitChunks } from '../protocol/framing';
import { parseDeviceMessage } from '../protocol/validate';
import { estimateAirtimeMs, toBinary, toHex, toTriState, validateSignal } from '../domain/signal';

describe('bytes', () => {
  it('round-trips UTF-8 including multi-byte and surrogate pairs', () => {
    const s = 'Salon lumière – 灯 🔌';
    expect(utf8Decode(utf8Encode(s))).toBe(s);
    expect(utf8Encode('é')).toEqual(Uint8Array.from([0xc3, 0xa9]));
  });

  it('round-trips base64 for all padding lengths', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 20, 244]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
    expect(bytesToBase64(utf8Encode('Man'))).toBe('TWFu');
    expect(bytesToBase64(utf8Encode('Ma'))).toBe('TWE=');
  });
});

describe('framing', () => {
  it('reassembles a message split at every possible byte boundary, incl. inside a multi-byte char', () => {
    const msg = { type: 'ack', id: 'x', name: 'Lumière 🔌' };
    const bytes = encodeMessage(msg);
    for (let size = 1; size <= bytes.length; size++) {
      const asm = new LineAssembler();
      const lines: string[] = [];
      for (const c of splitChunks(bytes, size)) lines.push(...asm.push(c).lines);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual(msg);
    }
  });

  it('handles several messages in one chunk and ignores CR/empty lines', () => {
    const asm = new LineAssembler();
    const { lines } = asm.push(utf8Encode('{"a":1}\r\n\n{"b":2}\n{"c"'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(asm.push(utf8Encode(':3}\n')).lines).toEqual(['{"c":3}']);
  });

  it('discards oversized messages and recovers on the next newline', () => {
    const asm = new LineAssembler(10);
    const r = asm.push(utf8Encode('x'.repeat(50) + '\n{"ok":1}\n'));
    expect(r.overflowed).toBe(1);
    expect(r.lines).toEqual(['{"ok":1}']);
  });

  it('refuses to encode messages over the limit', () => {
    expect(() => encodeMessage({ big: 'x'.repeat(5000) })).toThrow(/too large/);
  });
});

describe('validate inbound', () => {
  it('accepts a well-formed signal_received', () => {
    const r = parseDeviceMessage(
      JSON.stringify({
        v: 1,
        type: 'signal_received',
        signal: { protocol: 1, protocolName: 'PT2262/EV1527', bitLength: 24, value: '123456', pulseLength: 350, repeat: 10 },
        frames: 4,
        decoded: { hex: '0x01E240', binary: '000000011110001001000000' },
      }),
    );
    expect(r.ok).toBe(true);
  });

  it.each([
    ['not json', 'invalid JSON'],
    ['[1,2]', 'not an object'],
    ['{"type":"nope"}', 'unknown type'],
    ['{"v":2,"type":"ack"}', 'protocol v2'],
    ['{"type":"signal_received","signal":{"protocol":1},"frames":1,"decoded":{}}', 'bad signal_received'],
    ['{"type":"error","code":1}', 'bad error'],
  ])('rejects %s', (line, reason) => {
    const r = parseDeviceMessage(line);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });
});

describe('signal rules (mirror of firmware signal_model.cpp)', () => {
  const ok = { protocol: 1, bitLength: 24, value: '5393', pulseLength: 320, repeat: 10 };

  it('accepts a typical EV1527 code', () => expect(validateSignal(ok)).toBeNull());
  it('rejects unknown protocol', () => expect(validateSignal({ ...ok, protocol: 13 })).toMatch(/protocol/));
  it('rejects values that do not fit', () => expect(validateSignal({ ...ok, bitLength: 8, value: '256' })).toMatch(/fit/));
  it('rejects > 32 bits', () => expect(validateSignal({ ...ok, bitLength: 33 })).toMatch(/bitLength/));
  it('rejects non-decimal values', () => expect(validateSignal({ ...ok, value: '0x10' })).toMatch(/decimal/));
  it('rejects out-of-range pulse', () => expect(validateSignal({ ...ok, pulseLength: 20 })).toMatch(/pulse/));
  it('rejects too many repeats', () => expect(validateSignal({ ...ok, repeat: 21 })).toMatch(/repeat/));

  it('estimates airtime like the firmware', () => {
    // protocol 1: (4 pulses/bit * 24 + 32 sync) * 320us * 10 = 409.6 ms
    expect(estimateAirtimeMs(ok)).toBe(410);
  });

  it('formats decoded views', () => {
    expect(toHex(ok)).toBe('0x001511');
    expect(toBinary(ok)).toBe('000000000001010100010001');
    // pairs: 00 00 00 00 00 01 01 01 00 01 00 01
    expect(toTriState(ok)).toBe('00000FFF0F0F');
  });
});
