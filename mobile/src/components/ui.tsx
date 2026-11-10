// Small design-system primitives used across screens.
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts, radius, space, type } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, scroll = true, edges = ['top'] }: { children: ReactNode; scroll?: boolean; edges?: ('top' | 'bottom')[] }) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.scroll, { flex: 1 }]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={type.title}>{title}</Text>
        {subtitle ? <Text style={[type.monoSmall, { marginTop: 4 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}>
        {children}
      </Pressable>
    );
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ marginTop: space.xl }}>
      <View style={styles.sectionHead}>
        <Text style={type.label}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'secondary',
  icon,
  loading,
  disabled,
  style,
  compact,
}: {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  compact?: boolean;
}) {
  const v = variants[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title || icon}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        compact && styles.btnCompact,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !off && styles.pressed,
        off && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon ? <Ionicons name={icon} size={compact ? 15 : 17} color={v.fg} /> : null}
      <Text style={[styles.btnText, compact && { fontSize: 13 }, { color: v.fg }]}>{title}</Text>
    </Pressable>
  );
}

const variants: Record<ButtonVariant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.accent, fg: '#06251C', border: colors.accent },
  secondary: { bg: colors.surfaceAlt, fg: colors.text, border: colors.border },
  danger: { bg: colors.dangerDim, fg: colors.danger, border: '#6A2A33' },
  ghost: { bg: 'transparent', fg: colors.accent, border: 'transparent' },
};

export function IconButton({ icon, onPress, color = colors.text, label }: { icon: IconName; onPress: () => void; color?: string; label: string }) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={color} />
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && { backgroundColor: colors.accentDim, borderColor: colors.accent }]}
    >
      <Text style={[styles.chipText, selected && { color: colors.accent }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, maxLength }: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
}) {
  return (
    <View style={{ marginBottom: space.lg }}>
      <Text style={[type.label, { marginBottom: space.sm }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        maxLength={maxLength}
        style={styles.input}
      />
    </View>
  );
}

export function ToggleRow({ label, hint, value, onValueChange }: { label: string; hint?: string; value: boolean; onValueChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: space.md }}>
        <Text style={type.body}>{label}</Text>
        {hint ? <Text style={[type.small, { marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.accentDim, false: colors.surfaceHi }} thumbColor={value ? colors.accent : colors.textDim} />
    </View>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={type.small}>{k}</Text>
      {typeof v === 'string' || typeof v === 'number' ? (
        <Text style={[mono ? type.mono : type.body, { flexShrink: 1, textAlign: 'right' }]} selectable>
          {v}
        </Text>
      ) : (
        v
      )}
    </View>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={28} color={colors.accent} />
      </View>
      <Text style={[type.h3, { marginTop: space.md }]}>{title}</Text>
      <Text style={[type.small, { textAlign: 'center', marginTop: space.xs, maxWidth: 280 }]}>{body}</Text>
      {action ? <View style={{ marginTop: space.lg }}>{action}</View> : null}
    </View>
  );
}

export function Banner({ tone = 'warn', icon = 'information-circle', text, onClose }: { tone?: 'warn' | 'danger' | 'info'; icon?: IconName; text: string; onClose?: () => void }) {
  const c = tone === 'danger' ? colors.danger : tone === 'info' ? colors.info : colors.warn;
  return (
    <View style={[styles.banner, { borderColor: c + '55', backgroundColor: c + '14' }]}>
      <Ionicons name={icon} size={18} color={c} />
      <Text style={[type.small, { color: c, flex: 1 }]}>{text}</Text>
      {onClose ? <IconButton icon="close" onPress={onClose} color={c} label="Dismiss" /> : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: space.lg, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg, gap: space.md },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  pressed: { opacity: 0.75, transform: [{ scale: 0.985 }] },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: 12, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1 },
  btnCompact: { paddingVertical: 7, paddingHorizontal: space.md },
  btnText: { fontSize: 15, fontFamily: fonts.bodySemi },
  iconBtn: { padding: 6, borderRadius: radius.sm },
  chip: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { color: colors.textDim, fontSize: 13, fontFamily: fonts.bodyMedium },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, color: colors.text, fontSize: 15, fontFamily: fonts.body },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, gap: space.md },
  empty: { alignItems: 'center', paddingVertical: space.xxl, paddingHorizontal: space.lg },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: 1, marginBottom: space.md },
});

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={stepStyles.stepper}>
      <Pressable accessibilityLabel="Decrease" disabled={value <= min} onPress={() => onChange(value - 1)} style={[stepStyles.stepBtn, value <= min && { opacity: 0.3 }]}>
        <Ionicons name="remove" size={18} color={colors.text} />
      </Pressable>
      <Text style={stepStyles.stepValue}>{value}</Text>
      <Pressable accessibilityLabel="Increase" disabled={value >= max} onPress={() => onChange(value + 1)} style={[stepStyles.stepBtn, value >= max && { opacity: 0.3 }]}>
        <Ionicons name="add" size={18} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** Small uppercase mono tag (layout type, status). */
export function Tag({ label, fg = colors.textDim, bg = colors.surfaceHi }: { label: string; fg?: string; bg?: string }) {
  return (
    <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, backgroundColor: bg, borderWidth: 1, borderColor: fg + '33' }}>
      <Text style={{ fontFamily: fonts.monoBold, fontSize: 10, letterSpacing: 1.2, color: fg, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 999, borderWidth: 1, borderColor: colors.border },
  stepBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepValue: { minWidth: 24, textAlign: 'center', color: colors.text, fontFamily: fonts.monoBold, fontSize: 16 },
});
