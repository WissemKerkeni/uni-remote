// Draws raw edge timings as a square wave (first frame of a capture).
// timings[0] is the sync gap (low); then alternating high/low per bit.
import { StyleSheet, Text, View } from 'react-native';

import { colors, type } from '../theme';

export function PulseView({ timings, height = 36 }: { timings: number[]; height?: number }) {
  if (timings.length < 3) return null;
  // Skip the long sync gap so the bits are readable; show it as a marker.
  const bits = timings.slice(1);
  const total = bits.reduce((a, b) => a + b, 0) || 1;
  return (
    <View>
      <View style={[styles.wave, { height }]}>
        {bits.map((d, i) => {
          const high = i % 2 === 0;
          return (
            <View
              key={i}
              style={{
                flexGrow: d / total,
                flexBasis: 0,
                height: high ? height : 2,
                alignSelf: high ? 'flex-start' : 'flex-end',
                backgroundColor: high ? colors.accent : colors.accentDim,
                borderTopLeftRadius: high ? 1 : 0,
                borderTopRightRadius: high ? 1 : 0,
              }}
            />
          );
        })}
      </View>
      <Text style={[type.small, { fontSize: 11, marginTop: 4 }]}>
        sync gap {timings[0]} µs · {bits.length} edges · {Math.round(total / 1000)} ms frame
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wave: { flexDirection: 'row', alignItems: 'stretch', gap: 0.5, overflow: 'hidden' },
});
