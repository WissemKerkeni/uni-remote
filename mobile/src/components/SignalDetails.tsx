import { StyleSheet, Text, View } from 'react-native';

import { estimateAirtimeMs, protocolName, toBinary, toHex, toTriState } from '../domain/signal';
import type { Capture, RfSignal } from '../domain/types';
import { colors, radius, space, type } from '../theme';
import { PulseView } from './PulseView';
import { KeyValue } from './ui';

export function SignalSummary({ signal }: { signal: RfSignal }) {
  return (
    <Text style={[type.mono, { color: colors.textDim, fontSize: 12 }]} numberOfLines={1}>
      P{signal.protocol} · {signal.bitLength}b · {toHex(signal)} · {signal.pulseLength}µs
    </Text>
  );
}

/** Full decode view for a capture (Learn screen). */
export function CaptureDetails({ capture }: { capture: Capture }) {
  const s = capture.signal;
  const tri = capture.decoded.triState ?? toTriState(s);
  return (
    <View>
      <View style={styles.hero}>
        <Text style={type.label}>Decoded value</Text>
        <Text style={styles.value} selectable>
          {s.value}
        </Text>
        <Text style={[type.mono, { color: colors.accent }]} selectable>
          {capture.decoded.hex ?? toHex(s)}
        </Text>
      </View>
      <View style={styles.bits}>
        <Text style={[type.mono, { fontSize: 12, letterSpacing: 1 }]} selectable>
          {groupBits(capture.decoded.binary ?? toBinary(s))}
        </Text>
      </View>
      {capture.timings?.length ? (
        <View style={{ marginBottom: space.md }}>
          <PulseView timings={capture.timings} />
        </View>
      ) : null}
      <KeyValue k="Protocol" v={`${s.protocol} · ${s.protocolName ?? protocolName(s.protocol)}`} />
      <KeyValue k="Bit length" v={`${s.bitLength} bits`} />
      <KeyValue k="Pulse length" v={`${s.pulseLength} µs (measured)`} />
      {tri ? <KeyValue k="Tri-state (PT2262)" v={tri} mono /> : null}
      <KeyValue k="Frames received" v={`${capture.frames} in ${capture.durationMs} ms`} />
      <KeyValue k="Modulation" v={capture.modulation} />
      <KeyValue k="Frequency" v={`${capture.frequencyMHz.toFixed(2)} MHz (${capture.frequencySource})`} />
      <KeyValue k="Est. airtime / send" v={`${estimateAirtimeMs(s)} ms × ${s.repeat} frames`} />
      {capture.frequencySource === 'nominal' ? (
        <Text style={[type.small, { fontSize: 11, marginTop: space.xs }]}>
          The receiver module cannot measure frequency; 433.92 MHz is its nominal tuning.
        </Text>
      ) : null}
    </View>
  );
}

function groupBits(b: string) {
  return b.replace(/(.{4})/g, '$1 ').trim();
}

const styles = StyleSheet.create({
  hero: { alignItems: 'flex-start', marginBottom: space.md },
  value: { fontSize: 30, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'], marginVertical: 2 },
  bits: { backgroundColor: colors.bg, borderRadius: radius.sm, padding: space.md, marginBottom: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
