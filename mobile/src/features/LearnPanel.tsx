// Signal learning: start/stop receive mode, show decoded captures, save them
// (after an authorization confirmation) or assign them to a remote button.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { CaptureDetails, SignalSummary } from '../components/SignalDetails';
import { Banner, Button, Card, Chip, EmptyState, Field, IconButton, Section, ToggleRow } from '../components/ui';
import { protocolName } from '../domain/signal';
import type { Capture, RfSignal } from '../domain/types';
import { errorMessage, startLearning, stopLearning, transmit } from '../services/deviceManager';
import { useDevice } from '../store/deviceStore';
import { useRemotes } from '../store/remotesStore';
import { useSettings } from '../store/settingsStore';
import { colors, radius, space, type } from '../theme';

export interface AssignTarget {
  remoteId: string;
  buttonId: string;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function notify(title: string, msg: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

export function LearnPanel({ assign }: { assign?: AssignTarget }) {
  const status = useDevice((s) => s.status);
  const learning = useDevice((s) => s.learning);
  const captures = useDevice((s) => s.captures);
  const settings = useSettings();
  const signals = useRemotes((s) => s.signals);
  const [busy, setBusy] = useState(false);
  const now = useNow(learning.active);

  const remote = useRemotes((s) => (assign ? s.remotes.find((r) => r.id === assign.remoteId) : undefined));
  const button = remote?.buttons.find((b) => b.id === assign?.buttonId);

  const connected = status === 'connected';
  const remaining = learning.active && learning.endsAt ? Math.max(0, Math.ceil((learning.endsAt - now) / 1000)) : 0;

  const toggle = async () => {
    setBusy(true);
    try {
      if (learning.active) await stopLearning();
      else await startLearning();
    } catch (e) {
      notify('Learning', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const assignSignal = (signal: RfSignal) => {
    if (!assign || !button) return;
    useRemotes.getState().upsertButton(assign.remoteId, { ...button, signal });
    if (learning.active) void stopLearning().catch(() => undefined);
    router.back();
  };

  return (
    <View>
      {assign && button ? (
        <Banner tone="info" icon="link" text={`Assigning a signal to “${button.label}” on ${remote?.name}.`} />
      ) : null}
      {!connected ? (
        <Banner
          tone="warn"
          icon="bluetooth"
          text="Connect to your UniRemote device to receive signals."
        />
      ) : null}

      <Card style={styles.listenCard}>
        <View style={[styles.ring, learning.active && { borderColor: colors.info, backgroundColor: colors.info + '18' }]}>
          <Ionicons name={learning.active ? 'radio' : 'radio-outline'} size={34} color={learning.active ? colors.info : colors.textDim} />
          {learning.active ? <Text style={[type.small, { color: colors.info, marginTop: 2 }]}>{remaining}s</Text> : null}
        </View>
        <Text style={[type.h2, { marginTop: space.md }]}>{learning.active ? 'Listening…' : 'Ready to learn'}</Text>
        <Text style={[type.small, { textAlign: 'center', marginTop: space.xs, maxWidth: 300 }]}>
          {learning.active
            ? 'Hold your original remote 10–50 cm from the receiver and press one button briefly.'
            : 'Start receive mode, then press a button on a compatible fixed-code 433 MHz remote.'}
        </Text>
        <Button
          style={{ marginTop: space.lg, alignSelf: 'stretch' }}
          variant={learning.active ? 'danger' : 'primary'}
          icon={learning.active ? 'stop' : 'play'}
          title={learning.active ? 'Stop listening' : 'Start listening'}
          loading={busy}
          disabled={!connected}
          onPress={toggle}
        />
        <View style={{ alignSelf: 'stretch', marginTop: space.sm }}>
          <ToggleRow
            label="Stop after first signal"
            value={settings.learnSingle}
            onValueChange={(v) => settings.set({ learnSingle: v })}
          />
          <ToggleRow
            label="Include raw timings"
            hint="Shows the pulse waveform (diagnostic, best effort)."
            value={settings.includeTimings}
            onValueChange={(v) => settings.set({ includeTimings: v })}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center', paddingVertical: space.sm }}>
            <Text style={[type.body, { flex: 1 }]}>Timeout</Text>
            {[15, 30, 60].map((s) => (
              <Chip key={s} label={`${s}s`} selected={settings.learnTimeoutSec === s} onPress={() => settings.set({ learnTimeoutSec: s })} />
            ))}
          </View>
        </View>
      </Card>

      <Section
        title={`Captured (${captures.length})`}
        right={captures.length ? <Button compact variant="ghost" title="Clear" onPress={() => useDevice.getState().clearCaptures()} /> : null}
      >
        {captures.length === 0 ? (
          <Card>
            <EmptyState
              icon="pulse"
              title="Nothing received yet"
              body="Only fixed-code remotes (PT2262, EV1527, HT12E and similar) can be decoded. Rolling-code remotes (most car keys and modern garage openers) are not supported."
            />
          </Card>
        ) : (
          captures.map((c, i) => <CaptureCard key={c.id} capture={c} expanded={i === 0} assign={assign ? assignSignal : undefined} />)
        )}
      </Section>

      {signals.length > 0 && (
        <Section title={`Library (${signals.length})`}>
          {signals.map((s) => (
            <Card key={s.id} style={{ marginBottom: space.sm, paddingVertical: space.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <View style={{ flex: 1 }}>
                  <Text style={type.h3}>{s.name}</Text>
                  <SignalSummary signal={s.signal} />
                </View>
                {assign ? (
                  <Button compact variant="primary" title="Use" onPress={() => assignSignal(s.signal)} />
                ) : (
                  <>
                    <SendButton sendKey={s.id} signal={s.signal} />
                    <IconButton
                      icon="trash-outline"
                      label="Delete signal"
                      color={colors.textDim}
                      onPress={() => useRemotes.getState().deleteSignal(s.id)}
                    />
                  </>
                )}
              </View>
            </Card>
          ))}
        </Section>
      )}
    </View>
  );
}

function SendButton({ sendKey, signal }: { sendKey: string; signal: RfSignal }) {
  const tx = useDevice((s) => s.tx[sendKey]);
  const connected = useDevice((s) => s.status === 'connected');
  const send = () => transmit(sendKey, signal).catch((e) => notify('Transmit failed', errorMessage(e)));
  return (
    <Button
      compact
      icon={tx?.state === 'ok' ? 'checkmark' : tx?.state === 'error' ? 'alert-circle' : 'paper-plane'}
      title={tx?.state === 'sending' ? 'Sending' : 'Send'}
      loading={tx?.state === 'sending'}
      disabled={!connected}
      onPress={send}
    />
  );
}

function CaptureCard({ capture, expanded, assign }: { capture: Capture; expanded: boolean; assign?: (s: RfSignal) => void }) {
  const [open, setOpen] = useState(expanded);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const s = capture.signal;

  const save = () => {
    if (assign) {
      assign(s);
      return;
    }
    useRemotes.getState().saveSignal(name || `${protocolName(s.protocol)} ${s.value}`, s);
    useDevice.getState().removeCapture(capture.id);
  };

  return (
    <Card style={{ marginBottom: space.md }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={styles.capIcon}>
          <Ionicons name="pulse" size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.h3}>
            {s.value} <Text style={type.small}>· {new Date(capture.receivedAt).toLocaleTimeString()}</Text>
          </Text>
          <SignalSummary signal={s} />
        </View>
        <IconButton icon={open ? 'chevron-up' : 'chevron-down'} label="Toggle details" onPress={() => setOpen(!open)} color={colors.textDim} />
      </View>

      {open ? (
        <View style={{ marginTop: space.md }}>
          <CaptureDetails capture={capture} />
        </View>
      ) : null}

      {saving ? (
        <View style={styles.saveBox}>
          {!assign ? <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Living room lamp ON" maxLength={60} /> : null}
          <ToggleRow
            label="I own this device or am authorized to control it"
            hint="UniRemote only re-sends fixed-code signals for your own equipment."
            value={authorized}
            onValueChange={setAuthorized}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
            <Button style={{ flex: 1 }} title="Cancel" onPress={() => setSaving(false)} />
            <Button style={{ flex: 1 }} variant="primary" icon="checkmark" title={assign ? 'Assign' : 'Save'} disabled={!authorized} onPress={save} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          <View style={{ flex: 1 }}>
            <SendButton sendKey={capture.id} signal={s} />
          </View>
          <Button
            style={{ flex: 1 }}
            compact
            variant="primary"
            icon={assign ? 'link' : 'bookmark'}
            title={assign ? 'Use for button' : 'Save'}
            onPress={() => setSaving(true)}
          />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  listenCard: { alignItems: 'center', paddingVertical: space.xl },
  ring: { width: 92, height: 92, borderRadius: 46, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  capIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentDim, alignItems: 'center', justifyContent: 'center' },
  saveBox: { marginTop: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
