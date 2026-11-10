import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDevice, type ConnectionStatus } from '../store/deviceStore';
import { colors, fonts, radius } from '../theme';

const LABEL: Record<ConnectionStatus, string> = {
  disconnected: 'Offline',
  scanning: 'Scanning',
  connecting: 'Connecting',
  reconnecting: 'Reconnecting',
  connected: 'Connected',
};

export function statusColor(s: ConnectionStatus) {
  if (s === 'connected') return colors.success;
  if (s === 'disconnected') return colors.textFaint;
  return colors.warn;
}

export function ConnectionBadge({ onPress }: { onPress?: () => void }) {
  const status = useDevice((s) => s.status);
  const learning = useDevice((s) => s.learning.active);
  const pulse = useRef(new Animated.Value(1)).current;
  const busy = status !== 'connected' && status !== 'disconnected';

  useEffect(() => {
    if (!busy && !learning) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [busy, learning, pulse]);

  const color = learning ? colors.info : statusColor(status);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Device ${LABEL[status]}`} style={[styles.badge, { borderColor: color + '55' }]}>
      <Animated.View style={[styles.dot, { backgroundColor: color, opacity: pulse }]} />
      <Text style={[styles.text, { color }]}>{learning ? 'Listening' : LABEL[status]}</Text>
    </Pressable>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1, backgroundColor: colors.surface },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { fontFamily: fonts.monoBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
});
