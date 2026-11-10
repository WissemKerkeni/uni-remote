// Dashboard (Stitch "UniRemote – Remotes Dashboard"): device card, recently
// used, remote cards with layout preview, last-signal telemetry, + FAB.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ConnectionBadge, statusColor } from '../../components/ConnectionBadge';
import { LayoutPreview } from '../../components/remote/LayoutPreview';
import { Banner, Button, Card, EmptyState, Screen, Section, Tag } from '../../components/ui';
import { protocolName, toBinary } from '../../domain/signal';
import type { Remote } from '../../domain/types';
import { activeMode } from '../../services/deviceManager';
import { useDevice } from '../../store/deviceStore';
import { useRemotes } from '../../store/remotesStore';
import { colors, fonts, layoutTag, radius, space, type } from '../../theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const CATEGORY_ICON: Record<string, IconName> = {
  Lights: 'bulb-outline',
  Outlets: 'flash-outline',
  Fan: 'aperture-outline',
  Blinds: 'reorder-four-outline',
  Doorbell: 'notifications-outline',
  'Gate (fixed-code)': 'git-commit-outline',
  'Key fob': 'key-outline',
  Climate: 'thermometer-outline',
  Other: 'radio-outline',
};

export default function Dashboard() {
  const remotes = useRemotes((s) => s.remotes);
  const status = useDevice((s) => s.status);
  const info = useDevice((s) => s.info);
  const name = useDevice((s) => s.deviceName);
  const mtu = useDevice((s) => s.mtu);
  const lastError = useDevice((s) => s.lastError);
  const lastCapture = useDevice((s) => s.captures[0]);

  const recent = useMemo(
    () => remotes.filter((r) => r.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 5),
    [remotes],
  );
  const connected = status === 'connected';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Screen>
        <View style={styles.topBar}>
          <Ionicons name="radio-outline" size={20} color={colors.accent} />
          <Text style={styles.brand}>UniRemote</Text>
          <View style={styles.freq}>
            <Text style={type.monoSmall}>433.92 MHz</Text>
          </View>
          <View style={{ flex: 1 }} />
          <ConnectionBadge onPress={() => router.push('/device')} />
        </View>

        <Text style={[type.title, { marginTop: space.lg }]}>Remotes</Text>
        <Text style={[type.monoSmall, { marginTop: 4, marginBottom: space.lg }]}>433 MHz universal remote · fixed-code OOK</Text>

        <Card onPress={() => router.push('/device')} style={{ padding: 0 }}>
          <View style={styles.deviceRow}>
            <View style={[styles.chip, { borderColor: statusColor(status) }]}>
              <Ionicons name="hardware-chip-outline" size={22} color={statusColor(status)} />
              {connected ? <View style={styles.chipDot} /> : null}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text style={type.h2} numberOfLines={1}>
                  {connected ? (name ?? 'UniRemote') : 'No device'}
                </Text>
                {connected ? <Tag label={activeMode() === 'mock' ? 'demo' : 'ready'} fg={colors.accent} bg={colors.accentDim} /> : null}
              </View>
              <Text style={[type.mono, { color: colors.textDim, fontSize: 12, marginTop: 2 }]} numberOfLines={2}>
                {connected && info
                  ? `${info.chipModel} · fw ${info.firmwareVersion}\nRX GPIO${info.radio.rxPin} / TX GPIO${info.radio.txPin}`
                  : status === 'disconnected'
                    ? 'Tap to scan for your ESP32'
                    : `${status}…`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </View>
          {connected && info ? (
            <View style={styles.deviceStrip}>
              <Text style={[type.monoSmall, { color: colors.accent }]}>● {info.radio.modulation}</Text>
              <Text style={type.monoSmall}>MTU {mtu}</Text>
              <Text style={[type.monoSmall, { color: info.radio.rxReady && info.radio.txReady ? colors.accent : colors.warn }]}>
                {info.radio.rxReady && info.radio.txReady ? 'RF OK' : 'RF CHECK'}
              </Text>
            </View>
          ) : null}
        </Card>
        {lastError && !connected ? (
          <View style={{ marginTop: space.md }}>
            <Banner tone="danger" icon="alert-circle" text={lastError} onClose={() => useDevice.getState().patch({ lastError: null })} />
          </View>
        ) : null}

        {recent.length > 0 && (
          <Section title="Recently used">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {recent.map((r) => (
                <Pressable key={r.id} onPress={() => router.push(`/remote/${r.id}`)} style={({ pressed }) => [styles.recent, pressed && { opacity: 0.7 }]}>
                  <Ionicons name={CATEGORY_ICON[r.category] ?? 'radio-outline'} size={15} color={colors.accent} />
                  <Text style={[type.body, { fontSize: 14 }]} numberOfLines={1}>
                    {r.name}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Section>
        )}

        <Section title={`Remotes (${remotes.length})`} right={remotes.length ? <Button compact variant="secondary" icon="add" title="New" onPress={() => router.push('/remote/new')} /> : null}>
          {remotes.length === 0 ? (
            <Card>
              <EmptyState
                icon="grid-outline"
                title="No remotes yet"
                body="Pick a ready layout – general, light, media, blinds, key fob or climate – or build a custom grid. Then teach each button from your original remote."
                action={<Button variant="primary" icon="add" title="Create remote" onPress={() => router.push('/remote/new')} />}
              />
            </Card>
          ) : (
            <View style={styles.grid}>
              {remotes.map((r) => (
                <RemoteCard key={r.id} remote={r} />
              ))}
            </View>
          )}
        </Section>

        {lastCapture ? (
          <Section title="Last signal">
            <Pressable onPress={() => router.push('/learn')} style={styles.telemetry}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[type.monoSmall, { color: colors.accent }]}>▮ RF RX</Text>
                <Text style={type.monoSmall}>CH 433.92 (nominal)</Text>
              </View>
              <Text style={[type.monoSmall, { marginTop: 6 }]}>
                PROTOCOL={lastCapture.signal.protocol} ({protocolName(lastCapture.signal.protocol)}) · PULSE={lastCapture.signal.pulseLength}µs
              </Text>
              <Text style={[type.monoSmall, { marginTop: 2, color: colors.text }]} numberOfLines={1}>
                {lastCapture.decoded.binary ?? toBinary(lastCapture.signal)} [{lastCapture.signal.bitLength}-bit]
              </Text>
            </Pressable>
          </Section>
        ) : null}
      </Screen>

      <Pressable accessibilityRole="button" accessibilityLabel="New remote" onPress={() => router.push('/remote/new')} style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}>
        <Ionicons name="add" size={30} color="#06251C" />
      </Pressable>
    </View>
  );
}

function RemoteCard({ remote }: { remote: Remote }) {
  const buttons = remote.buttons.filter((b) => (b.kind ?? 'button') === 'button');
  const ready = buttons.filter((b) => b.signal).length;
  const tag = layoutTag[remote.layout];
  return (
    <Pressable onPress={() => router.push(`/remote/${remote.id}`)} style={({ pressed }) => [styles.remoteCard, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={styles.remoteIcon}>
          <Ionicons name={CATEGORY_ICON[remote.category] ?? 'radio-outline'} size={19} color={colors.accent} />
        </View>
        <Tag label={tag.label} fg={tag.fg} bg={tag.bg} />
      </View>
      <Text style={[type.h3, { marginTop: space.md }]} numberOfLines={1}>
        {remote.name}
      </Text>
      <Text style={[type.monoSmall, { color: ready === buttons.length && buttons.length ? colors.accent : colors.textDim, marginTop: 2 }]}>
        {ready}/{buttons.length} buttons ready
      </Text>
      <View style={styles.cardRule} />
      <View style={{ alignItems: 'center' }}>
        <LayoutPreview layout={remote.layout} columns={remote.columns} buttons={remote.buttons} width={118} assigned />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingBottom: space.md, borderBottomWidth: 1, borderBottomColor: colors.border, marginHorizontal: -space.lg, paddingHorizontal: space.lg },
  brand: { fontFamily: fonts.heading, fontSize: 18, color: colors.text },
  freq: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  deviceStrip: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: 1, borderTopColor: colors.border },
  chip: { width: 46, height: 46, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  chipDot: { position: 'absolute', right: -3, bottom: -3, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.surface },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, maxWidth: 220 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  remoteCard: { flexGrow: 1, flexBasis: '45%', minWidth: 150, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg },
  remoteIcon: { width: 40, height: 40, borderRadius: 11, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  cardRule: { height: 1, backgroundColor: colors.border, marginVertical: space.md },
  telemetry: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
