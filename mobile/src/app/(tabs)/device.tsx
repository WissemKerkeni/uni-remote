// Device management: scan/connect, info, diagnostics, GPIO config, on-device store.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ConnectionBadge } from '../../components/ConnectionBadge';
import { SignalSummary } from '../../components/SignalDetails';
import { Banner, Button, Card, Chip, Header, KeyValue, Screen, Section } from '../../components/ui';
import {
  activeMode,
  connect,
  deleteStoredOnDevice,
  disconnect,
  errorMessage,
  loadConfig,
  loadStored,
  probeReceiver,
  loopbackTest,
  rebootDevice,
  refreshInfo,
  runDiagnostics,
  saveConfig,
  startScan,
  stopScan,
} from '../../services/deviceManager';
import { useDevice } from '../../store/deviceStore';
import { colors, radius, space, type } from '../../theme';

function say(title: string, msg: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      say('Device', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

const fmtUptime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
};

export default function DeviceScreen() {
  const d = useDevice();
  const { busy, run } = useAction();
  const connected = d.status === 'connected';
  const mode = activeMode();

  return (
    <Screen>
      <Header title="Device" subtitle={mode === 'mock' ? 'Demo mode – simulated device' : 'ESP32 over Bluetooth LE'} right={<ConnectionBadge />} />
      {mode === 'mock' ? <Banner tone="info" icon="flask" text="Simulator active: no radio is used. Switch to Bluetooth in Settings to use real hardware." /> : null}
      {d.lastError ? <Banner tone="danger" icon="alert-circle" text={d.lastError} onClose={() => d.patch({ lastError: null })} /> : null}

      <Card>
        <KeyValue k="Bluetooth adapter" v={d.adapter} />
        <KeyValue k="Link" v={d.status} />
        {connected ? <KeyValue k="Device" v={d.deviceName ?? '—'} /> : null}
        {connected ? <KeyValue k="ATT MTU" v={`${d.mtu} bytes`} /> : null}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
          {connected ? (
            <Button style={{ flex: 1 }} variant="danger" icon="close-circle" title="Disconnect" onPress={() => run('disc', disconnect)} loading={busy === 'disc'} />
          ) : d.status === 'scanning' ? (
            <Button style={{ flex: 1 }} icon="stop" title="Stop scan" onPress={() => run('scan', stopScan)} />
          ) : (
            <Button style={{ flex: 1 }} variant="primary" icon="search" title="Scan for devices" onPress={() => run('scan', startScan)} disabled={d.status !== 'disconnected'} />
          )}
        </View>
      </Card>

      {!connected && d.discovered.length > 0 && (
        <Section title="Nearby devices">
          {d.discovered.map((x) => (
            <Pressable key={x.id} onPress={() => run('conn', () => connect(x.id, x.name))} style={({ pressed }) => [styles.devRow, pressed && { opacity: 0.7 }]}>
              <Ionicons name="hardware-chip" size={20} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={type.h3}>{x.name}</Text>
                <Text style={[type.small, { fontSize: 11 }]}>{x.id}</Text>
              </View>
              <Text style={type.small}>{x.rssi != null ? `${x.rssi} dBm` : ''}</Text>
              {busy === 'conn' ? <Text style={type.small}>…</Text> : <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
            </Pressable>
          ))}
        </Section>
      )}
      {d.status === 'scanning' && d.discovered.length === 0 ? (
        <Text style={[type.small, { marginTop: space.md, textAlign: 'center' }]}>Looking for UniRemote devices… make sure the ESP32 is powered.</Text>
      ) : null}

      {connected && d.info ? (
        <Section title="Firmware" right={<Button compact variant="ghost" icon="refresh" title="Refresh" onPress={() => run('info', refreshInfo)} />}>
          <Card>
            <KeyValue k="Firmware" v={d.info.firmwareVersion} />
            <KeyValue k="Protocol" v={`v${d.info.protocolVersion}`} />
            <KeyValue k="Chip" v={`${d.info.chipModel} rev ${d.info.chipRevision} · ${d.info.cpuCores} cores`} />
            <KeyValue k="Flash" v={`${Math.round(d.info.flashSize / 1048576)} MB`} />
            <KeyValue k="BLE address" v={d.info.bleAddress} mono />
            <KeyValue k="Uptime" v={fmtUptime(d.info.uptimeMs)} />
            <KeyValue k="Radio" v={`${d.info.radio.modulation} · ${d.info.radio.frequencyMHz} MHz (${d.info.radio.frequencySource})`} />
            <KeyValue k="Receiver" v={`GPIO${d.info.radio.rxPin} · ${d.info.radio.rxReady ? 'ready' : 'not configured'}`} />
            <KeyValue k="Transmitter" v={`GPIO${d.info.radio.txPin} · ${d.info.radio.txReady ? 'ready' : 'not configured'}`} />
            <KeyValue k="Protocols" v={`${d.info.capabilities.protocols.length} fixed-code (rc-switch)`} />
          </Card>
        </Section>
      ) : null}

      {connected ? <ReceiverProbe busy={busy} run={run} /> : null}
      {connected ? <Diagnostics busy={busy} run={run} /> : null}
      {connected ? <GpioConfig busy={busy} run={run} /> : null}
      {connected ? <DeviceStore busy={busy} run={run} /> : null}
    </Screen>
  );
}

type ActionProps = ReturnType<typeof useAction>;

function Diagnostics({ busy, run }: ActionProps) {
  const diag = useDevice((s) => s.diagnostics);
  const ping = useDevice((s) => s.ping);
  const [showLog, setShowLog] = useState(false);
  return (
    <Section title="Diagnostics" right={<Button compact variant="ghost" icon="pulse" title="Run test" loading={busy === 'diag'} onPress={() => run('diag', () => runDiagnostics(5))} />}>
      <Card>
        {!diag ? (
          <Text style={type.small}>Runs 5 round-trip pings and reads the device's counters and log.</Text>
        ) : (
          <>
            {ping ? (
              <KeyValue
                k="Round trip"
                v={ping.failures === ping.count ? 'no answer' : `${ping.avgMs} ms avg (${ping.minMs}–${ping.maxMs}) · ${ping.count - ping.failures}/${ping.count} ok`}
              />
            ) : null}
            <KeyValue k="Free heap" v={`${Math.round(diag.freeHeap / 1024)} kB (min ${Math.round(diag.minFreeHeap / 1024)} kB)`} />
            <KeyValue k="Reset reason" v={`${diag.resetReason} · boot #${diag.bootCount}`} />
            <KeyValue k="Duty-cycle budget" v={`${(diag.rf.dutyBudgetMs / 1000).toFixed(1)} / ${diag.rf.dutyBudgetMaxMs / 1000} s`} />
            <KeyValue k="Frames / signals" v={`${diag.counters.rxFrames ?? 0} / ${diag.counters.rxSignals ?? 0} (noise ${diag.counters.rxNoise ?? 0})`} />
            <KeyValue k="TX ok / rejected" v={`${diag.counters.txOk ?? 0} / ${diag.counters.txRejected ?? 0}`} />
            <KeyValue k="Messages in / out" v={`${diag.counters.msgIn ?? 0} / ${diag.counters.msgOut ?? 0}`} />
            <KeyValue k="Parse errors / overflow" v={`${diag.counters.parseErrors ?? 0} / ${diag.counters.rxOverflow ?? 0}`} />
            <KeyValue k="Notify retries / failures" v={`${diag.counters.notifyRetries ?? 0} / ${diag.counters.notifyFailures ?? 0}`} />
            {diag.lastError ? <KeyValue k="Last error" v={diag.lastError} /> : null}
            {diag.log?.length ? (
              <>
                <Button compact variant="ghost" title={showLog ? 'Hide log' : `Show log (${diag.log.length})`} onPress={() => setShowLog(!showLog)} style={{ alignSelf: 'flex-start', marginTop: space.sm }} />
                {showLog ? (
                  <View style={styles.log}>
                    {diag.log.map((l, i) => (
                      <Text key={i} style={[type.mono, { fontSize: 11, color: l.msg.startsWith('E') ? colors.danger : l.msg.startsWith('W') ? colors.warn : colors.textDim }]} selectable>
                        {(l.ms / 1000).toFixed(1).padStart(7)} {l.msg}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </Card>
    </Section>
  );
}

const VERDICT: Record<string, { color: string; title: string; text: string }> = {
  active: {
    color: colors.success,
    title: 'Receiver is alive',
    text: 'The DATA pin is toggling. Super-regenerative receivers output constant noise, which is expected. You can start learning.',
  },
  quiet: {
    color: colors.warn,
    title: 'Connected, low noise',
    text: 'The receiver drives the pin, with little background noise (typical for an XY-MK-5V on 3.3 V, or a superheterodyne module). Run the loopback test below to confirm it decodes.',
  },
  no_activity: {
    color: colors.danger,
    title: 'No signal from the receiver',
    text: 'The pin stays LOW. Check VCC to 3V3, GND and DATA to the RX pin. An XY-MK-5V may not work at 3.3 V: if the wiring is right, use 5 V with a 10k/20k divider or a 3.3 V receiver module.',
  },
  floating: {
    color: colors.warn,
    title: 'Nothing connected to the RX pin',
    text: 'The pin floats (it reads HIGH once the internal pull-up is on), so no receiver output is attached. Check that receiver DATA goes to the RX pin shown below and that GND is shared.',
  },
  stuck_high: {
    color: colors.danger,
    title: 'Pin stuck HIGH',
    text: 'DATA reads HIGH all the time. Check that DATA is not connected to VCC and that the RX pin is correct.',
  },
};

function ReceiverProbe({ busy, run }: ActionProps) {
  const probe = useDevice((s) => s.probe);
  const loop = useDevice((s) => s.loopback);
  const v = probe ? VERDICT[probe.verdict] ?? VERDICT.quiet : null;
  return (
    <Section title="Receiver check" right={<Button compact variant="ghost" icon="pulse-outline" title={probe ? 'Probe again' : 'Probe receiver'} loading={busy === 'probe'} onPress={() => run('probe', () => probeReceiver(500))} />}>
      <Card>
        {!probe || !v ? (
          <Text style={type.small}>Watches the receiver DATA pin for 0.5 s, without decoding, to confirm the module is powered and wired. Run this first with an XY-MK-5V powered from 3.3 V.</Text>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: v.color }} />
              <Text style={[type.h3, { color: v.color }]}>{v.title}</Text>
            </View>
            <Text style={[type.small, { marginTop: space.sm, lineHeight: 19 }]}>{v.text}</Text>
            <View style={{ marginTop: space.md }}>
              <KeyValue k="Pin" v={`GPIO${probe.rxPin}`} mono />
              <KeyValue k="Edges" v={`${probe.edges} in ${probe.durationMs} ms (${probe.edgesPerSecond}/s)`} mono />
              <KeyValue k="Time HIGH" v={`${Math.round(probe.highRatio * 100)} %`} mono />
            </View>
          </>
        )}
        <View style={{ marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <Text style={[type.h3, { flex: 1 }]}>Loopback self-test</Text>
            <Button compact icon="repeat" title={loop ? 'Run again' : 'Run'} loading={busy === 'loop'} onPress={() => run('loop', loopbackTest)} />
          </View>
          {!loop ? (
            <Text style={[type.small, { marginTop: space.sm }]}>Sends a test code on the device's own transmitter and checks that its receiver decodes it. No remote needed; transmitter and receiver must both be wired.</Text>
          ) : (
            <View style={{ marginTop: space.sm }}>
              <Text style={[type.h3, { color: loop.match ? colors.success : loop.received ? colors.warn : colors.danger }]}>
                {loop.match ? 'PASS – TX and RX both work' : loop.received ? 'Partial – decoded something else' : 'FAIL – nothing decoded'}
              </Text>
              <KeyValue k="Sent" v={`P${loop.sent.protocol} · ${loop.sent.bitLength}b · ${loop.sent.value}`} mono />
              <KeyValue k="Received" v={loop.got ? `P${loop.got.protocol} · ${loop.got.bitLength}b · ${loop.got.value} · ${loop.got.pulseLength}µs` : '—'} mono />
              <KeyValue k="Frames decoded" v={`${loop.framesDecoded} of ${loop.sent.repeat}`} mono />
            </View>
          )}
        </View>
      </Card>
    </Section>
  );
}

function GpioConfig({ busy, run }: ActionProps) {
  const cfg = useDevice((s) => s.config);
  const [rx, setRx] = useState<number | null>(null);
  const [tx, setTx] = useState<number | null>(null);
  const curRx = rx ?? cfg?.pending?.rxPin ?? cfg?.rxPin;
  const curTx = tx ?? cfg?.pending?.txPin ?? cfg?.txPin;
  return (
    <Section title="GPIO mapping" right={<Button compact variant="ghost" icon="download-outline" title={cfg ? 'Reload' : 'Load'} loading={busy === 'cfg'} onPress={() => run('cfg', loadConfig)} />}>
      <Card>
        {!cfg ? (
          <Text style={type.small}>Load the current pin configuration from the device.</Text>
        ) : (
          <>
            <Text style={[type.label, { marginBottom: space.sm }]}>Receiver DATA pin</Text>
            <View style={styles.pins}>
              {cfg.allowedRxPins.map((p) => (
                <Chip key={p} label={String(p)} selected={curRx === p} onPress={() => setRx(p)} />
              ))}
            </View>
            <Text style={[type.label, { marginVertical: space.sm }]}>Transmitter DATA pin</Text>
            <View style={styles.pins}>
              {cfg.allowedTxPins.map((p) => (
                <Chip key={p} label={String(p)} selected={curTx === p} onPress={() => setTx(p)} />
              ))}
            </View>
            <Text style={[type.small, { marginTop: space.md }]}>
              Only pins that are safe at boot are listed. GPIO 34–39 are input-only (receiver only). Changes apply after a reboot.
            </Text>
            {cfg.rebootRequired ? <View style={{ marginTop: space.md }}><Banner tone="warn" icon="refresh-circle" text={`Pending: RX GPIO${cfg.pending?.rxPin}, TX GPIO${cfg.pending?.txPin}. Reboot to apply.`} /></View> : null}
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <Button
                style={{ flex: 1 }}
                variant="primary"
                title="Save"
                disabled={curRx == null || curTx == null || curRx === curTx}
                loading={busy === 'cfgsave'}
                onPress={() => run('cfgsave', () => saveConfig({ rxPin: curRx!, txPin: curTx! }))}
              />
              <Button style={{ flex: 1 }} icon="refresh" title="Reboot" loading={busy === 'reboot'} onPress={() => run('reboot', rebootDevice)} />
            </View>
          </>
        )}
      </Card>
    </Section>
  );
}

function DeviceStore({ busy, run }: ActionProps) {
  const stored = useDevice((s) => s.stored);
  return (
    <Section title="Signals stored on device" right={<Button compact variant="ghost" icon="list" title={stored ? 'Reload' : 'Load'} loading={busy === 'store'} onPress={() => run('store', loadStored)} />}>
      <Card>
        {!stored ? (
          <Text style={type.small}>The ESP32 can keep up to 32 signals in flash as a backup (Settings → back up library).</Text>
        ) : stored.items.length === 0 ? (
          <Text style={type.small}>No signals stored on the device ({stored.capacity} slots free).</Text>
        ) : (
          stored.items.map((it) => (
            <View key={it.slot} style={styles.storeRow}>
              <Text style={[type.mono, { color: colors.textFaint, width: 28 }]}>#{it.slot}</Text>
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{it.name || '(unnamed)'}</Text>
                <SignalSummary signal={it.signal} />
              </View>
              <Button compact variant="ghost" icon="trash-outline" title="" onPress={() => run('store', () => deleteStoredOnDevice(it.slot))} />
            </View>
          ))
        )}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  devRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, marginBottom: space.sm },
  log: { marginTop: space.sm, padding: space.sm, backgroundColor: colors.bg, borderRadius: radius.sm },
  pins: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  storeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
