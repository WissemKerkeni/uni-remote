// Button editor: label, colour, icon, layout (width/shape/role), signal,
// order, delete. Headings and spacers get a reduced editor.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { SignalSummary } from '../../components/SignalDetails';
import { Button, Card, Chip, EmptyState, Field, Screen, Section } from '../../components/ui';
import { describeSignal, toHex } from '../../domain/signal';
import { columnsFor } from '../../domain/templates';
import {
  BUTTON_COLORS,
  BUTTON_ICONS,
  BUTTON_SHAPES,
  type ButtonColor,
  type ButtonIcon,
  type ButtonRole,
  type ButtonShape,
  type RemoteButton,
} from '../../domain/types';
import { useRemotes } from '../../store/remotesStore';
import { buttonPalette, colors, fonts, radius, space, type } from '../../theme';

const FOB_ROLES: { id: ButtonRole; label: string }[] = [
  { id: 'lock', label: 'Lock' },
  { id: 'unlock', label: 'Unlock' },
  { id: 'trunk', label: 'Trunk' },
  { id: 'aux', label: 'Aux' },
  { id: 'panic', label: 'Panic' },
];
const CLIMATE_ROLES: { id: ButtonRole; label: string }[] = [
  { id: 'power', label: 'Power' },
  { id: 'temp_up', label: 'Temp +' },
  { id: 'temp_down', label: 'Temp −' },
  { id: 'mode', label: 'Mode' },
  { id: 'fan', label: 'Fan' },
  { id: 'swing', label: 'Swing' },
  { id: 'timer', label: 'Timer' },
  { id: 'sleep', label: 'Sleep' },
  { id: 'eco', label: 'Eco' },
];

export default function ButtonEditor() {
  const { remoteId, buttonId } = useLocalSearchParams<{ remoteId: string; buttonId: string }>();
  const remote = useRemotes((s) => s.remotes.find((r) => r.id === remoteId));
  const button = remote?.buttons.find((b) => b.id === buttonId);
  const upsert = useRemotes((s) => s.upsertButton);

  const [label, setLabel] = useState(button?.label ?? '');
  const [color, setColor] = useState<ButtonColor>(button?.color ?? 'slate');
  const [icon, setIcon] = useState<ButtonIcon | undefined>(button?.icon);

  // Persist cosmetic edits immediately so "Learn" / back keeps them.
  useEffect(() => {
    if (!button) return;
    if (button.label !== label || button.color !== color || button.icon !== icon) {
      upsert(remoteId, { ...button, label, color, icon });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, color, icon]);

  if (!remote || !button) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="help-circle-outline" title="Button not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const set = (patch: Partial<RemoteButton>) => upsert(remoteId, { ...button, ...patch });
  const kind = button.kind ?? 'button';
  const isGrid = remote.layout === 'custom' || remote.layout === 'grid2' || remote.layout === 'grid3';
  const cols = columnsFor(remote.layout, remote.columns);
  const roles = remote.layout === 'keyfob' ? FOB_ROLES : remote.layout === 'climate' ? CLIMATE_ROLES : null;

  const arrangeAndDelete = (
    <>
      <Section title="Arrange">
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button style={{ flex: 1 }} icon="arrow-back" title="Earlier" onPress={() => useRemotes.getState().moveButton(remoteId, buttonId, -1)} />
          <Button style={{ flex: 1 }} icon="arrow-forward" title="Later" onPress={() => useRemotes.getState().moveButton(remoteId, buttonId, 1)} />
        </View>
      </Section>
      <Button
        style={{ marginTop: space.xl }}
        variant="danger"
        icon="trash"
        title={kind === 'button' ? 'Delete button' : kind === 'label' ? 'Delete heading' : 'Delete spacer'}
        onPress={() => {
          useRemotes.getState().deleteButton(remoteId, buttonId);
          router.back();
        }}
      />
      <Button style={{ marginTop: space.sm }} variant="ghost" title="Done" onPress={() => router.back()} />
    </>
  );

  // ---------------------------------------------------------------- heading / spacer
  if (kind !== 'button') {
    return (
      <Screen edges={['bottom']}>
        <Stack.Screen options={{ title: kind === 'label' ? 'Heading' : 'Spacer' }} />
        {kind === 'label' ? (
          <Field label="Heading text" value={label} onChangeText={setLabel} maxLength={40} placeholder="e.g. Scenes" />
        ) : (
          <>
            <Text style={[type.small, { marginBottom: space.md }]}>A spacer leaves an empty cell in the grid – useful for d-pads and aligned rows.</Text>
            <WidthPicker cols={cols} value={button.span ?? 1} onChange={(span) => set({ span })} />
          </>
        )}
        {arrangeAndDelete}
      </Screen>
    );
  }

  // ---------------------------------------------------------------- button
  const p = buttonPalette[color];
  const shape: ButtonShape = button.shape ?? 'rounded';
  return (
    <Screen edges={['bottom']}>
      <Stack.Screen options={{ title: label || 'Button' }} />

      <View
        style={[
          styles.preview,
          { backgroundColor: p.bg, borderColor: p.border },
          shape === 'circle' && { borderRadius: 65 },
          shape === 'pill' && { width: 220, height: 72, borderRadius: 36, flexDirection: 'row', gap: space.sm },
        ]}
      >
        <Ionicons name={icon ?? 'radio-button-on'} size={30} color={p.fg} />
        <Text style={{ color: p.fg, fontFamily: fonts.bodySemi, fontSize: 16, marginTop: shape === 'pill' ? 0 : space.sm }}>{label || 'Button'}</Text>
      </View>

      <Field label="Label" value={label} onChangeText={setLabel} maxLength={40} placeholder="e.g. Lamp ON" />

      <Text style={[type.label, { marginBottom: space.sm }]}>Colour</Text>
      <View style={styles.wrap}>
        {BUTTON_COLORS.map((c) => (
          <Pressable
            key={c}
            accessibilityLabel={`Colour ${c}`}
            onPress={() => setColor(c)}
            style={[styles.swatch, { backgroundColor: buttonPalette[c].bg, borderColor: c === color ? colors.accent : buttonPalette[c].border }]}
          >
            <View style={[styles.swatchDot, { backgroundColor: buttonPalette[c].fg }]} />
          </Pressable>
        ))}
      </View>

      <Section title="Icon">
        <View style={styles.wrap}>
          {BUTTON_ICONS.map((i) => (
            <Pressable key={i} accessibilityLabel={`Icon ${i}`} onPress={() => setIcon(i)} style={[styles.iconCell, i === icon && { borderColor: colors.accent, backgroundColor: colors.accentDim }]}>
              <Ionicons name={i} size={20} color={i === icon ? colors.accent : colors.textDim} />
            </Pressable>
          ))}
        </View>
      </Section>

      {isGrid ? (
        <Section title="Layout">
          <WidthPicker cols={cols} value={button.span ?? 1} onChange={(span) => set({ span })} />
          <Text style={[type.small, { marginTop: space.md, marginBottom: space.sm }]}>Shape</Text>
          <View style={styles.wrap}>
            {BUTTON_SHAPES.map((s) => (
              <Chip key={s} label={s === 'rounded' ? 'Rounded' : s === 'circle' ? 'Circle' : 'Pill'} selected={shape === s} onPress={() => set({ shape: s })} />
            ))}
          </View>
        </Section>
      ) : null}

      {roles ? (
        <Section title="Position on the remote">
          <View style={styles.wrap}>
            {roles.map((r) => (
              <Chip key={r.id} label={r.label} selected={button.role === r.id} onPress={() => set({ role: button.role === r.id ? undefined : r.id })} />
            ))}
          </View>
          <Text style={[type.small, { marginTop: space.sm }]}>Buttons without a role are added below the main controls.</Text>
        </Section>
      ) : null}

      <Section title="Signal">
        <Card>
          {button.signal ? (
            <>
              <Text style={type.h3}>{describeSignal(button.signal)}</Text>
              <SignalSummary signal={button.signal} />
              <Text style={[type.monoSmall, { marginTop: space.xs }]}>
                {toHex(button.signal)} · repeats per press: {button.signal.repeat}
              </Text>
            </>
          ) : (
            <Text style={type.small}>No signal assigned yet.</Text>
          )}
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button
              style={{ flex: 1 }}
              variant="primary"
              icon="radio"
              title={button.signal ? 'Re-learn' : 'Learn / pick'}
              onPress={() => router.push({ pathname: '/remote/learn', params: { remoteId, buttonId } })}
            />
            {button.signal ? <Button style={{ flex: 1 }} icon="close" title="Clear" onPress={() => set({ signal: undefined })} /> : null}
          </View>
          {button.signal ? (
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, alignItems: 'center' }}>
              <Text style={[type.small, { flex: 1 }]}>Repeats</Text>
              {[4, 10, 15, 20].map((r) => (
                <Button key={r} compact variant={button.signal!.repeat === r ? 'primary' : 'secondary'} title={String(r)} onPress={() => set({ signal: { ...button.signal!, repeat: r } })} />
              ))}
            </View>
          ) : null}
        </Card>
      </Section>

      {arrangeAndDelete}
    </Screen>
  );
}

function WidthPicker({ cols, value, onChange }: { cols: number; value: number; onChange: (v: number) => void }) {
  return (
    <View>
      <Text style={[type.small, { marginBottom: space.sm }]}>Width (columns of {cols})</Text>
      <View style={styles.wrap}>
        {Array.from({ length: cols }, (_, i) => i + 1).map((n) => (
          <Chip key={n} label={n === cols ? `${n} · full` : String(n)} selected={Math.min(value, cols) === n} onPress={() => onChange(n)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: { alignSelf: 'center', width: 130, height: 130, borderRadius: radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginBottom: space.xl },
  wrap: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  swatch: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatchDot: { width: 14, height: 14, borderRadius: 7 },
  iconCell: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
