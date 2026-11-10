import { columnsFor, packRows, TEMPLATES } from '../domain/templates';
import { buildExport, parseImport } from '../services/profileFile';
import { BUTTON_COLORS, BUTTON_ICONS, BUTTON_ROLES, REMOTE_CATEGORIES, type Remote } from '../domain/types';

describe('packRows (custom grid)', () => {
  const items = (spans: (number | 'label')[]) => spans.map((s) => (s === 'label' ? { kind: 'label' as const } : { span: s }));

  it('fills rows left to right and wraps', () => {
    const rows = packRows(items([1, 1, 1, 1]), 3);
    expect(rows.map((r) => r.length)).toEqual([3, 1]);
  });

  it('wraps an item that does not fit the remaining space', () => {
    const rows = packRows(items([2, 2, 1]), 3);
    expect(rows.map((r) => r.map((c) => c.span))).toEqual([[2], [2, 1]]);
  });

  it('clamps spans to the column count and makes labels full-width', () => {
    const rows = packRows(items([9, 'label', 1]), 3);
    expect(rows.map((r) => r.map((c) => c.span))).toEqual([[3], [3], [1]]);
  });

  it('columnsFor maps legacy layouts and clamps custom', () => {
    expect(columnsFor('grid2')).toBe(2);
    expect(columnsFor('list')).toBe(1);
    expect(columnsFor('custom', 9)).toBe(5);
    expect(columnsFor('custom', 0)).toBe(1);
    expect(columnsFor('custom')).toBe(3);
  });
});

describe('templates', () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s is well-formed', (_id, t) => {
    expect((REMOTE_CATEGORIES as readonly string[]).includes(t.category)).toBe(true);
    for (const b of t.buttons) {
      expect((BUTTON_COLORS as readonly string[]).includes(b.color)).toBe(true);
      if (b.icon) expect((BUTTON_ICONS as readonly string[]).includes(b.icon)).toBe(true);
      if (b.role) expect((BUTTON_ROLES as readonly string[]).includes(b.role)).toBe(true);
      if (b.span) expect(b.span).toBeLessThanOrEqual(columnsFor(t.layout, t.columns));
      expect(b.signal).toBeUndefined(); // templates never ship signals
    }
  });

  it('media template forms a 3-column d-pad (spacers keep alignment)', () => {
    const t = TEMPLATES.find((x) => x.id === 'media')!;
    const rows = packRows(t.buttons, 3);
    expect(rows.slice(0, 4).map((r) => r.map((c) => (c.item.kind === 'spacer' ? '_' : c.item.label)))).toEqual([
      ['Power', '_', 'Mode'],
      ['_', 'Up', '_'],
      ['Left', 'OK', 'Right'],
      ['_', 'Down', '_'],
    ]);
  });

  it('key fob and climate templates define the roles their layouts place', () => {
    const roles = (id: string) => TEMPLATES.find((t) => t.id === id)!.buttons.map((b) => b.role);
    expect(roles('keyfob')).toEqual(expect.arrayContaining(['lock', 'unlock', 'trunk', 'panic']));
    expect(roles('climate')).toEqual(expect.arrayContaining(['power', 'temp_up', 'temp_down', 'mode', 'fan', 'swing', 'timer']));
  });
});

describe('import keeps layout fields', () => {
  it('round-trips custom grid, fob and climate remotes and sanitises bad values', () => {
    const now = 1;
    const remotes: Remote[] = [
      {
        id: 'r1', name: 'Grid', category: 'Lights', layout: 'custom', columns: 4, createdAt: now, updatedAt: now,
        buttons: [
          { id: 'a', label: 'Wide', color: 'mint', span: 3, shape: 'pill' },
          { id: 'b', label: 'Scenes', color: 'slate', kind: 'label' },
          { id: 'c', label: '', color: 'slate', kind: 'spacer', span: 2 },
        ],
      },
      { id: 'r2', name: 'Fob', category: 'Key fob', layout: 'keyfob', createdAt: now, updatedAt: now, buttons: [{ id: 'd', label: 'Lock', color: 'red', role: 'lock', shape: 'circle' }] },
    ];
    const doc: any = buildExport(remotes, []);
    doc.remotes[0].columns = 42;
    doc.remotes[0].buttons[0].span = 99;
    doc.remotes[1].buttons[0].role = 'self_destruct';
    const r = parseImport(JSON.stringify(doc));
    expect(r.remotes[0].layout).toBe('custom');
    expect(r.remotes[0].columns).toBe(5);
    expect(r.remotes[0].buttons[0]).toMatchObject({ span: 5, shape: 'pill' });
    expect(r.remotes[0].buttons[1].kind).toBe('label');
    expect(r.remotes[0].buttons[2]).toMatchObject({ kind: 'spacer', span: 2 });
    expect(r.remotes[1].layout).toBe('keyfob');
    expect(r.remotes[1].buttons[0].role).toBeUndefined();
  });
});
