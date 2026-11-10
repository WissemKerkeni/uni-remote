// Draws a remote according to its layout: custom/legacy grid, key fob or climate panel.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { toHex } from '../../domain/signal';
import { columnsFor, packRows } from '../../domain/templates';
import type { ButtonRole, Remote, RemoteButton } from '../../domain/types';
import { useDevice } from '../../store/deviceStore';
import { buttonPalette, colors, fonts, radius, space, type } from '../../theme';
import { RemoteButtonTile, useTxFeedback } from '../RemoteButtonTile';

export interface SurfaceProps {
  remote: Remote;
  editing: boolean;
  onButtonPress: (b: RemoteButton) => void;
}

export function RemoteSurface(props: SurfaceProps) {
  switch (props.remote.layout) {
    case 'keyfob':
      return <KeyFobLayout {...props} />;
    case 'climate':
      return <ClimateLayout {...props} />;
    default:
      return <GridLayout {...props} />;
  }
}

// ---------------------------------------------------------------- last action

function useLastAction(remote: Remote) {
  const tx = useDevice((s) => s.tx);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  let best: { label: string; at: number; ok: boolean; sending: boolean } | null = null;
  for (const b of remote.buttons) {
    const t = tx[b.id];
    if (!t) continue;
    const at = t.state === 'sending' ? Date.now() : t.at;
    if (!best || at > best.at) best = { label: b.label, at, ok: t.state === 'ok', sending: t.state === 'sending' };
  }
  return best;
}

function ago(at: number) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)} min ago`;
}

export function LastActionLine({ remote, inline }: { remote: Remote; inline?: boolean }) {
  const last = useLastAction(remote);
  if (!last) return <Text style={[type.small, inline ? undefined : styles.lastLine]}>No command sent yet</Text>;
  return (
    <View style={[styles.lastRow, inline && { alignSelf: 'flex-start', marginBottom: 0 }]}>
      <Ionicons name={last.sending ? 'radio' : last.ok ? 'checkmark-circle' : 'alert-circle'} size={14} color={last.sending ? colors.info : last.ok ? colors.success : colors.danger} />
      <Text style={[type.small, { color: colors.text }]}>
        {last.label} · {last.sending ? 'sending…' : last.ok ? `sent ${ago(last.at)}` : 'failed'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------- grid

function GridLayout({ remote, editing, onButtonPress }: SurfaceProps) {
  const cols = columnsFor(remote.layout, remote.columns);
  const rows = useMemo(() => packRows(remote.buttons, cols), [remote.buttons, cols]);
  const list = remote.layout === 'list';
  return (
    <View style={{ gap: space.md }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space.md }}>
          {row.map(({ item, span }) => {
            const flex = { flex: span, minWidth: 0 };
            if (item.kind === 'label')
              return (
                <Pressable key={item.id} style={[flex, styles.heading]} disabled={!editing} onPress={() => onButtonPress(item)}>
                  <Text style={type.label}>{item.label || 'Section'}</Text>
                  {editing ? <Ionicons name="pencil" size={11} color={colors.textFaint} /> : null}
                  <View style={styles.headingRule} />
                </Pressable>
              );
            if (item.kind === 'spacer')
              return editing ? (
                <Pressable key={item.id} onPress={() => onButtonPress(item)} style={[flex, styles.spacerEdit]}>
                  <Text style={[type.small, { fontSize: 10 }]}>spacer</Text>
                </Pressable>
              ) : (
                <View key={item.id} style={flex} />
              );
            return (
              <View key={item.id} style={flex}>
                <RemoteButtonTile
                  button={item}
                  variant={list ? 'row' : cols >= 4 ? 'compact' : 'tile'}
                  editing={editing}
                  onPress={() => onButtonPress(item)}
                  style={item.shape === 'circle' ? { alignSelf: 'center', width: '100%', maxWidth: 110 } : undefined}
                />
              </View>
            );
          })}
          {/* keep partial rows left-aligned */}
          {row.reduce((n, r) => n + r.span, 0) < cols ? <View style={{ flex: cols - row.reduce((n, r) => n + r.span, 0) }} /> : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------- key fob

const FOB_ORDER: ButtonRole[] = ['lock', 'unlock', 'trunk', 'aux', 'panic'];

function KeyFobLayout({ remote, editing, onButtonPress }: SurfaceProps) {
  const ordered = useMemo(() => {
    const byRole = (r: ButtonRole) => remote.buttons.filter((b) => b.role === r);
    const known = FOB_ORDER.flatMap(byRole);
    return [...known, ...remote.buttons.filter((b) => !known.includes(b))].filter((b) => b.kind !== 'spacer' && b.kind !== 'label');
  }, [remote.buttons]);
  const sending = useDevice((s) => ordered.some((b) => s.tx[b.id]?.state === 'sending'));
  const ref = ordered.find((b) => b.signal)?.signal;

  return (
    <View>
      <View style={styles.statusCard}>
        <LastActionLine remote={remote} inline />
      </View>
      {ref ? (
        <View style={styles.telemetry}>
          <Text style={type.monoSmall}>CH 433.92 MHz</Text>
          <Text style={type.monoSmall}>|</Text>
          <Text style={type.monoSmall}>{(ref.protocolName ?? `P${ref.protocol}`).toUpperCase()}</Text>
          <Text style={type.monoSmall}>|</Text>
          <Text style={[type.monoSmall, { color: colors.accent }]}>{ref.bitLength}-BIT</Text>
        </View>
      ) : null}

      <View style={{ alignItems: 'center', marginTop: space.xl }}>
        <View style={styles.fobLoop} />
        <View style={styles.fob}>
          <View style={styles.fobHead}>
            <View style={[styles.fobLed, sending && styles.fobLedOn]} />
            <Text style={[styles.fobHeadText, sending && { color: colors.accent }]}>RF TX</Text>
            <Text style={[styles.fobHeadText, { flex: 1, textAlign: 'right', color: colors.textFaint }]} numberOfLines={1}>
              UNIREMOTE
            </Text>
          </View>
          {ordered.map((b) => (
            <FobButton key={b.id} button={b} editing={editing} small={b.role === 'panic'} onPress={() => onButtonPress(b)} />
          ))}
          <View style={styles.fobGrip} />
        </View>
      </View>
    </View>
  );
}

function FobButton({ button, editing, small, onPress }: { button: RemoteButton; editing: boolean; small: boolean; onPress: () => void }) {
  const { status } = useTxFeedback(button.id);
  const p = buttonPalette[button.color];
  const ring = status === 'ok' ? colors.success : status === 'error' ? colors.danger : '#262C35';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${button.label}${button.signal ? '' : ', no signal assigned'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fobBtn,
        small && { paddingVertical: 8 },
        { borderColor: ring },
        pressed && { transform: [{ scale: 0.97 }] },
        !button.signal && !editing && { opacity: 0.45 },
      ]}
    >
      <View style={[styles.fobIcon, small && { width: 42, height: 42 }, { borderColor: p.border }]}>
        {status === 'sending' ? (
          <ActivityIndicator color={p.fg} />
        ) : (
          <Ionicons
            name={status === 'ok' ? 'checkmark' : status === 'error' ? 'alert' : (button.icon ?? 'radio-button-on')}
            size={small ? 20 : 24}
            color={status === 'error' ? colors.danger : p.fg}
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.fobLabel, { color: button.color === 'slate' ? colors.text : p.fg }, small && { fontSize: 14 }]}>{button.label.toUpperCase()}</Text>
        <Text style={styles.fobHex}>{button.signal ? toHex(button.signal) : editing ? 'tap to learn' : 'no signal'}</Text>
      </View>
      {editing ? <Ionicons name="pencil" size={14} color={colors.accent} /> : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------- climate

const CLIMATE_GRID: ButtonRole[] = ['mode', 'fan', 'swing', 'timer'];

function ClimateLayout({ remote, editing, onButtonPress }: SurfaceProps) {
  const pick = (r: ButtonRole) => remote.buttons.find((b) => b.role === r);
  const power = pick('power');
  const up = pick('temp_up');
  const down = pick('temp_down');
  const grid = CLIMATE_GRID.map(pick).filter(Boolean) as RemoteButton[];
  const placed = new Set([power, up, down, ...grid].filter(Boolean).map((b) => b!.id));
  const rest = remote.buttons.filter((b) => !placed.has(b.id) && b.kind !== 'spacer' && b.kind !== 'label');
  const last = useLastAction(remote);

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.display}>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: '#5FBF9C' }]}>Last command</Text>
          <Text style={styles.displayValue} numberOfLines={1}>
            {last ? last.label : '—'}
          </Text>
          <Text style={[type.monoSmall, { color: '#7FA898' }]}>
            {last ? (last.sending ? 'sending…' : last.ok ? `sent ${ago(last.at)} · one-way RF` : 'failed') : 'one-way RF · state is not read back'}
          </Text>
        </View>
        <View style={styles.displayIcon}>
          <Ionicons name="thermometer-outline" size={22} color={colors.accent} />
        </View>
      </View>

      {power ? (
        <RemoteButtonTile button={{ ...power, label: power.label.toUpperCase() }} shape="pill" editing={editing} onPress={() => onButtonPress(power)} style={{ minHeight: 64 }} />
      ) : null}

      {up || down ? (
        <View style={styles.tempPanel}>
          <Text style={[type.label, { textAlign: 'center', color: colors.text }]}>Temp</Text>
          {up ? <RemoteButtonTile button={up} editing={editing} onPress={() => onButtonPress(up)} style={styles.tempBtn} /> : null}
          {down ? <RemoteButtonTile button={down} editing={editing} onPress={() => onButtonPress(down)} style={styles.tempBtn} /> : null}
        </View>
      ) : null}

      {grid.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {grid.map((b) => (
            <View key={b.id} style={{ width: '47%', flexGrow: 1 }}>
              <RemoteButtonTile button={b} editing={editing} onPress={() => onButtonPress(b)} style={{ minHeight: 104 }} />
            </View>
          ))}
        </View>
      ) : null}

      {rest.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          {rest.map((b) => (
            <View key={b.id} style={{ width: '47%', flexGrow: 1 }}>
              <RemoteButtonTile button={b} shape="pill" editing={editing} onPress={() => onButtonPress(b)} />
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lastLine: { textAlign: 'center', marginBottom: space.md },
  lastRow: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginBottom: space.md },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.sm },
  headingRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  spacerEdit: { minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },

  statusCard: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  telemetry: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  fobLoop: { width: 52, height: 26, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 5, borderBottomWidth: 0, borderColor: '#3A414C', marginBottom: -4 },
  fob: {
    width: '86%',
    maxWidth: 340,
    padding: space.lg,
    paddingTop: space.md,
    gap: space.md,
    borderRadius: 44,
    backgroundColor: '#16191F',
    borderWidth: 1.5,
    borderColor: '#2E343E',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 14 },
  },
  fobHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingVertical: 4 },
  fobHeadText: { fontFamily: fonts.monoBold, fontSize: 12, letterSpacing: 2, color: colors.textDim },
  fobLed: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#24403A', borderWidth: 1, borderColor: '#2E5A4E' },
  fobLedOn: { backgroundColor: colors.accent, shadowColor: colors.accent, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  fobBtn: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: 10, borderRadius: 22, backgroundColor: '#0F1216', borderWidth: 1.5 },
  fobIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#1D2229', borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fobLabel: { fontFamily: fonts.heading, fontSize: 16, letterSpacing: 1 },
  fobHex: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.textDim, marginTop: 1 },
  fobGrip: { alignSelf: 'center', width: 64, height: 3, borderRadius: 2, backgroundColor: '#262C35', marginTop: space.xs },

  display: { flexDirection: 'row', alignItems: 'center', padding: space.lg, borderRadius: radius.lg, backgroundColor: '#0D1B16', borderWidth: 1, borderColor: colors.accentLine },
  displayValue: { fontFamily: fonts.display, fontSize: 30, color: colors.accent, marginVertical: 2, letterSpacing: -0.5 },
  displayIcon: { width: 46, height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.accentLine, backgroundColor: '#10261F', alignItems: 'center', justifyContent: 'center' },
  tempPanel: { padding: space.md, gap: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  tempBtn: { minHeight: 92 },
});
