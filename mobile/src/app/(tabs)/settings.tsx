import { useState } from 'react';
import { Alert, Platform, Text, View } from 'react-native';

import { Button, Card, Chip, Header, KeyValue, Screen, Section, ToggleRow } from '../../components/ui';
import { activeMode, backupSignalToDevice, errorMessage, initTransport } from '../../services/deviceManager';
import { pickJsonFile, shareJsonFile } from '../../services/fileIO';
import { buildExport, parseImport } from '../../services/profileFile';
import { useDevice } from '../../store/deviceStore';
import { useRemotes } from '../../store/remotesStore';
import { useSettings, type TransportMode } from '../../store/settingsStore';
import { colors, space, type } from '../../theme';

function say(title: string, msg: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${msg}`);
  else Alert.alert(title, msg);
}

function ask(title: string, msg: string, options: { text: string; destructive?: boolean; onPress: () => void }[]) {
  if (Platform.OS === 'web') {
    // Web: confirm() only supports yes/no – use the first option.
    if (window.confirm(`${title}\n\n${msg}`)) options[0].onPress();
    return;
  }
  Alert.alert(title, msg, [
    { text: 'Cancel', style: 'cancel' },
    ...options.map((o) => ({ text: o.text, style: o.destructive ? ('destructive' as const) : ('default' as const), onPress: o.onPress })),
  ]);
}

export default function SettingsScreen() {
  const settings = useSettings();
  const remotes = useRemotes((s) => s.remotes);
  const signals = useRemotes((s) => s.signals);
  const connected = useDevice((s) => s.status === 'connected');
  const [busy, setBusy] = useState<string | null>(null);

  const setMode = (m: TransportMode) => {
    settings.set({ transportMode: m });
    initTransport(m);
  };

  const doExport = async () => {
    setBusy('export');
    try {
      const date = new Date().toISOString().slice(0, 10);
      await shareJsonFile(`uniremote-profiles-${date}.json`, JSON.stringify(buildExport(remotes, signals), null, 2));
    } catch (e) {
      say('Export failed', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    setBusy('import');
    try {
      const text = await pickJsonFile();
      if (text == null) return;
      const data = parseImport(text);
      const summary = `${data.remotes.length} remotes, ${data.signals.length} library signals.${data.warnings.length ? `\n\n${data.warnings.length} warning(s):\n• ${data.warnings.slice(0, 5).join('\n• ')}` : ''}`;
      ask('Import profiles', summary, [
        { text: 'Merge', onPress: () => useRemotes.getState().importData(data, 'merge') },
        { text: 'Replace all', destructive: true, onPress: () => useRemotes.getState().importData(data, 'replace') },
      ]);
    } catch (e) {
      say('Import failed', errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const backup = async () => {
    setBusy('backup');
    let ok = 0;
    try {
      for (const s of signals.slice(0, 32)) {
        await backupSignalToDevice(s.name, s.signal);
        ok++;
      }
      say('Backup complete', `${ok} signal(s) stored on the device.`);
    } catch (e) {
      say('Backup stopped', `${ok} stored. ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const clear = () =>
    ask('Clear all data?', `This deletes ${remotes.length} remotes and ${signals.length} saved signals from this phone. It cannot be undone. Export first if unsure.`, [
      { text: 'Delete everything', destructive: true, onPress: () => useRemotes.getState().clearAll() },
    ]);

  return (
    <Screen>
      <Header title="Settings" />

      <Section title="Connection">
        <Card>
          <Text style={[type.small, { marginBottom: space.sm }]}>Transport</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Chip label="Bluetooth LE" selected={settings.transportMode === 'ble'} onPress={() => setMode('ble')} />
            <Chip label="Demo simulator" selected={settings.transportMode === 'mock'} onPress={() => setMode('mock')} />
          </View>
          {Platform.OS === 'web' ? <Text style={[type.small, { marginTop: space.sm, color: colors.warn }]}>Bluetooth is not available on web; the simulator is used.</Text> : null}
          <Text style={[type.small, { marginTop: space.sm }]}>Active: {activeMode() === 'mock' ? 'simulator (no radio)' : 'Bluetooth LE'}</Text>
          <ToggleRow label="Auto-reconnect" hint="Reconnect to the last device on launch and after link loss." value={settings.autoReconnect} onValueChange={(v) => settings.set({ autoReconnect: v })} />
        </Card>
      </Section>

      <Section title="Data">
        <Card>
          <KeyValue k="Remotes" v={String(remotes.length)} />
          <KeyValue k="Buttons" v={String(remotes.reduce((n, r) => n + r.buttons.length, 0))} />
          <KeyValue k="Library signals" v={String(signals.length)} />
          <View style={{ gap: space.sm, marginTop: space.md }}>
            <Button icon="share-outline" title="Export profiles (JSON)" loading={busy === 'export'} disabled={!remotes.length && !signals.length} onPress={doExport} />
            <Button icon="download-outline" title="Import profiles" loading={busy === 'import'} onPress={doImport} />
            <Button icon="hardware-chip-outline" title="Back up library to device" loading={busy === 'backup'} disabled={!connected || !signals.length} onPress={backup} />
            <Button variant="danger" icon="trash" title="Clear all data" disabled={!remotes.length && !signals.length} onPress={clear} />
          </View>
        </Card>
      </Section>

      <Section title="About & safe use">
        <Card>
          <KeyValue k="App" v="UniRemote 1.0.0" />
          <KeyValue k="BLE protocol" v="v1" />
          <Text style={[type.small, { marginTop: space.md, lineHeight: 19 }]}>
            UniRemote works with simple fixed-code 433 MHz remotes (PT2262, EV1527, HT12E and similar) that use ASK/OOK modulation.
            It does not decode or replay rolling-code, encrypted or FSK remotes, and must only be used with equipment you own or are
            authorized to control. Transmissions are limited to a 10 % duty cycle to respect SRD band rules; check your local regulations.
          </Text>
        </Card>
      </Section>
    </Screen>
  );
}
