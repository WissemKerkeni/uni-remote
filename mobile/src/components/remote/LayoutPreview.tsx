// Miniature, non-interactive drawing of a remote layout (template cards,
// dashboard cards). Pure shapes – no icons – so it stays light.
import { StyleSheet, View } from 'react-native';

import { columnsFor, packRows } from '../../domain/templates';
import type { RemoteButton, RemoteLayout } from '../../domain/types';
import { buttonPalette, colors } from '../../theme';

type Item = Pick<RemoteButton, 'color' | 'span' | 'shape' | 'kind' | 'role'> & { signal?: unknown };

export function LayoutPreview({ layout, columns, buttons, width = 96, assigned }: { layout: RemoteLayout; columns?: number; buttons: Item[]; width?: number; assigned?: boolean }) {
  const dot = (b: Item) => {
    const p = buttonPalette[b.color];
    // On dashboard cards, dim buttons that have no signal yet.
    return { backgroundColor: assigned && !b.signal ? colors.surfaceHi : p.fg, opacity: assigned && !b.signal ? 1 : 0.85 };
  };

  if (layout === 'keyfob') {
    const items = buttons.filter((b) => b.kind !== 'spacer' && b.kind !== 'label').slice(0, 5);
    return (
      <View style={[styles.frame, { width }]}>
        <View style={styles.fob}>
          <View style={styles.fobLed} />
          {items.map((b, i) => (
            <View key={i} style={[styles.fobRow, b.role === 'panic' && { width: '72%' }]}>
              <View style={[styles.fobIcon, dot(b)]} />
              <View style={styles.fobText} />
            </View>
          ))}
        </View>
      </View>
    );
  }

  if (layout === 'climate') {
    const find = (r: string) => buttons.find((b) => b.role === r);
    const side = ['mode', 'fan', 'swing', 'timer'].map(find).filter(Boolean) as Item[];
    return (
      <View style={[styles.frame, { width, gap: 4 }]}>
        <View style={styles.lcd} />
        {find('power') ? <View style={[styles.bar, dot(find('power')!)]} /> : null}
        <View style={{ flexDirection: 'row', gap: 4 }}>
          <View style={styles.rocker}>
            <View style={[styles.rockerHalf, dot(find('temp_up') ?? { color: 'amber' })]} />
            <View style={[styles.rockerHalf, dot(find('temp_down') ?? { color: 'blue' })]} />
          </View>
          <View style={{ flex: 2, flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
            {side.map((b, i) => (
              <View key={i} style={[styles.cell, { width: '46%' }, { backgroundColor: colors.surfaceHi }]} />
            ))}
          </View>
        </View>
      </View>
    );
  }

  const cols = columnsFor(layout, columns);
  const rows = packRows(buttons.slice(0, 18), cols);
  if (!rows.length) {
    return (
      <View style={[styles.frame, styles.empty, { width }]}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.dashed} />
        ))}
      </View>
    );
  }
  return (
    <View style={[styles.frame, { width, gap: 3 }]}>
      {rows.slice(0, 7).map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 3 }}>
          {row.map(({ item, span }, j) =>
            item.kind === 'label' ? (
              <View key={j} style={{ flex: span, height: 3, marginVertical: 2, backgroundColor: colors.border, borderRadius: 2 }} />
            ) : item.kind === 'spacer' ? (
              <View key={j} style={{ flex: span }} />
            ) : (
              <View
                key={j}
                style={[
                  styles.cell,
                  { flex: span },
                  item.shape === 'circle' && { aspectRatio: 1, flex: 0, width: 10, alignSelf: 'center', marginHorizontal: 'auto' as any, borderRadius: 6 },
                  item.shape === 'pill' && { borderRadius: 6 },
                  layout === 'list' && { height: 7 },
                  dot(item),
                ]}
              />
            ),
          )}
          {row.reduce((n, r) => n + r.span, 0) < cols ? <View style={{ flex: cols - row.reduce((n, r) => n + r.span, 0) }} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 8, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  cell: { height: 10, borderRadius: 3 },
  empty: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'center' },
  dashed: { width: '44%', height: 18, borderRadius: 4, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.textFaint },
  fob: { alignSelf: 'center', width: '70%', paddingVertical: 6, paddingHorizontal: 5, borderRadius: 12, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: '#2C323C', gap: 3, alignItems: 'center' },
  fobLed: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent, marginBottom: 1 },
  fobRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 3, padding: 2, borderRadius: 4, backgroundColor: colors.bg },
  fobIcon: { width: 7, height: 7, borderRadius: 2 },
  fobText: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.surfaceHi },
  lcd: { height: 10, borderRadius: 3, backgroundColor: '#0E1A17', borderWidth: 1, borderColor: colors.accentLine },
  bar: { height: 6, borderRadius: 3 },
  rocker: { flex: 1, borderRadius: 8, overflow: 'hidden', gap: 2 },
  rockerHalf: { height: 12 },
});
