import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { ButtonShape, RemoteButton } from '../domain/types';
import { useDevice } from '../store/deviceStore';
import { buttonPalette, colors, fonts, radius, space } from '../theme';

export type TileVariant = 'tile' | 'row' | 'fob' | 'compact';

/** Transmission feedback for one button: 'sending' | 'ok' | 'error' | undefined (idle). */
export function useTxFeedback(buttonId: string) {
  const tx = useDevice((s) => s.tx[buttonId]);
  const [flash, setFlash] = useState(false);
  const at = tx && tx.state !== 'sending' ? tx.at : 0;
  useEffect(() => {
    if (!at) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [at]);
  const status = tx?.state === 'sending' ? 'sending' : flash ? tx?.state : undefined;
  return { status, message: tx?.state === 'error' ? tx.message : undefined };
}

/** One remote button; shows transmission status from the device store. */
export function RemoteButtonTile({
  button,
  variant = 'tile',
  shape,
  editing,
  onPress,
  onLongPress,
  style,
  size,
}: {
  button: RemoteButton;
  variant?: TileVariant;
  shape?: ButtonShape;
  editing: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  style?: ViewStyle;
  /** Diameter for circle/fob buttons. */
  size?: number;
}) {
  const { status, message } = useTxFeedback(button.id);
  const p = buttonPalette[button.color];
  const s = shape ?? button.shape ?? 'rounded';
  const row = variant === 'row';
  const fob = variant === 'fob';
  const ring = status === 'ok' ? colors.success : status === 'error' ? colors.danger : p.border;
  const iconSize = fob ? 30 : row ? 22 : variant === 'compact' ? 20 : 26;

  const shapeStyle: ViewStyle =
    s === 'circle' || fob
      ? { borderRadius: 999, aspectRatio: 1, ...(size ? { width: size, height: size } : null) }
      : s === 'pill'
        ? { borderRadius: 999, minHeight: 56 }
        : { borderRadius: radius.lg };

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${button.label}${button.signal ? '' : ', no signal assigned'}`}
      style={({ pressed }) => [
        styles.base,
        row ? styles.row : s === 'pill' ? styles.pill : styles.tile,
        variant === 'compact' && styles.compact,
        shapeStyle,
        { backgroundColor: p.bg, borderColor: ring },
        status === 'ok' && styles.okGlow,
        pressed && { transform: [{ scale: 0.95 }], opacity: 0.88 },
        !button.signal && !editing && { opacity: 0.45 },
        editing && s === 'pill' && { paddingRight: 30 },
        style,
      ]}
    >
      <View style={styles.highlight} pointerEvents="none" />
      <View style={row ? styles.rowIcon : undefined}>
        {status === 'sending' ? (
          <ActivityIndicator color={p.fg} />
        ) : (
          <Ionicons
            name={status === 'ok' ? 'checkmark-circle' : status === 'error' ? 'alert-circle' : (button.icon ?? 'radio-button-on')}
            size={iconSize}
            color={status === 'error' ? colors.danger : p.fg}
          />
        )}
      </View>
      {fob ? null : (
        <View style={row ? { flex: 1 } : { alignItems: 'center' }}>
          <Text style={[styles.label, { color: p.fg }, !row && { textAlign: 'center' }, variant === 'compact' && { fontSize: 12 }]} numberOfLines={2}>
            {button.label}
          </Text>
          {status === 'error' && message && row ? (
            <Text style={[styles.sub, { color: colors.danger }]} numberOfLines={2}>
              {message}
            </Text>
          ) : !button.signal && variant !== 'compact' ? (
            <Text style={styles.sub}>{editing ? 'tap to set' : 'no signal'}</Text>
          ) : null}
        </View>
      )}
      {editing ? (
        <View style={styles.editBadge}>
          <Ionicons name="pencil" size={11} color={colors.bg} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderWidth: 1.5, overflow: 'hidden' },
  tile: { minHeight: 92, alignItems: 'center', justifyContent: 'center', gap: 6, padding: space.md },
  pill: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.lg, paddingHorizontal: space.lg, borderRadius: radius.lg },
  compact: { minHeight: 64, padding: space.sm },
  rowIcon: { width: 30, alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  sub: { fontSize: 10, color: colors.textDim, marginTop: 2, fontFamily: fonts.mono },
  highlight: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: 'rgba(255,255,255,0.035)' },
  okGlow: { shadowColor: colors.success, shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  editBadge: { position: 'absolute', top: 7, right: 7, width: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
});
