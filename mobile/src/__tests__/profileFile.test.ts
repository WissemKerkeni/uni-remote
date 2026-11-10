import { buildExport, parseImport } from '../services/profileFile';
import type { Remote, SavedSignal } from '../domain/types';

const signal = { protocol: 1, bitLength: 24, value: '5393', pulseLength: 320, repeat: 10 };
const remote: Remote = {
  id: 'r1',
  name: 'Lamp',
  category: 'Lights',
  layout: 'grid2',
  buttons: [
    { id: 'b1', label: 'On', color: 'mint', icon: 'power', signal },
    { id: 'b2', label: 'Off', color: 'red' },
  ],
  createdAt: 1,
  updatedAt: 1,
};
const saved: SavedSignal = { id: 's1', name: 'Lamp on', signal, createdAt: 1 };

describe('profile export/import', () => {
  it('round-trips', () => {
    const text = JSON.stringify(buildExport([remote], [saved]));
    const r = parseImport(text);
    expect(r.warnings).toEqual([]);
    expect(r.remotes[0].buttons[0].signal).toEqual(signal);
    expect(r.remotes[0].buttons[1].signal).toBeUndefined();
    expect(r.signals[0].name).toBe('Lamp on');
  });

  it('strips unsupported signals with a warning', () => {
    const doc = buildExport(
      [{ ...remote, buttons: [{ id: 'x', label: 'Car key', color: 'red', signal: { ...signal, bitLength: 66, value: '1' } }] }],
      [{ ...saved, signal: { ...signal, protocol: 42 } }],
    );
    const r = parseImport(JSON.stringify(doc));
    expect(r.remotes[0].buttons[0].signal).toBeUndefined();
    expect(r.signals).toHaveLength(0);
    expect(r.warnings).toHaveLength(2);
  });

  it('sanitises unknown enum values', () => {
    const doc: any = buildExport([{ ...remote, category: 'Spaceship', layout: 'hex' } as any], []);
    doc.remotes[0].buttons[0].color = 'neon';
    const r = parseImport(JSON.stringify(doc));
    expect(r.remotes[0].category).toBe('Other');
    expect(r.remotes[0].layout).toBe('grid2');
    expect(r.remotes[0].buttons[0].color).toBe('slate');
  });

  it('rejects foreign or future files', () => {
    expect(() => parseImport('{"hello":1}')).toThrow(/Not a UniRemote/);
    expect(() => parseImport(JSON.stringify({ format: 'uniremote.profiles', version: 99 }))).toThrow(/version/);
    expect(() => parseImport('nope')).toThrow(/JSON/);
  });
});
