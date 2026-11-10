// Remote control screen: tap a button to transmit; edit mode to configure
// name, category, layout (incl. custom grid columns) and buttons.
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { ConnectionBadge } from '../../components/ConnectionBadge';
import { RemoteSurface } from '../../components/remote/RemoteSurface';
import { Banner, Button, Chip, EmptyState, Field, Screen, Section, Stepper, Tag } from '../../components/ui';
import { columnsFor } from '../../domain/templates';
import { MAX_COLUMNS, MIN_COLUMNS, REMOTE_CATEGORIES, REMOTE_LAYOUTS, type RemoteButton } from '../../domain/types';
import { errorMessage, transmit } from '../../services/deviceManager';
import { useDevice } from '../../store/deviceStore';
import { useRemotes } from '../../store/remotesStore';
import { colors, layoutTag, radius, space, type } from '../../theme';

function confirm(title: string, message: string, onYes: () => void) {
  if (Platform.OS === 'web') {
    if (window.confirm(`${title}\n\n${message}`)) onYes();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: onYes },
  ]);
}

const LAYOUT_NOTES: Partial<Record<string, string>> = {
  keyfob: 'Fixed-code fobs only. Car keys and most garage remotes use rolling codes, which UniRemote cannot learn or replay.',
  climate: 'For 433 MHz fans, heaters and RF climate controllers. Most air-conditioners use infrared, which this hardware does not cover.',
};

export default function RemoteScreen() {
  const { id, edit } = useLocalSearchParams<{ id: string; edit?: string }>();
  const remote = useRemotes((s) => s.remotes.find((r) => r.id === id));
  const connected = useDevice((s) => s.status === 'connected');
  const [editing, setEditing] = useState(edit === '1');
  const [lastError, setLastError] = useState<string | null>(null);

  if (!remote) {
    return (
      <Screen edges={['bottom']}>
        <EmptyState icon="help-circle-outline" title="Remote not found" body="It may have been deleted." />
      </Screen>
    );
  }

  const openEditor = (b: RemoteButton) => router.push({ pathname: '/remote/button', params: { remoteId: remote.id, buttonId: b.id } });

  const press = async (b: RemoteButton) => {
    if (editing || !b.signal) return openEditor(b);
    if (b.kind === 'label' || b.kind === 'spacer') return;
    setLastError(null);
    useRemotes.getState().markUsed(remote.id);
    try {
      await transmit(b.id, b.signal);
    } catch (e) {
      setLastError(`${b.label}: ${errorMessage(e)}`);
    }
  };

  const add = (kind: 'button' | 'label' | 'spacer') => {
    const n = remote.buttons.filter((b) => (b.kind ?? 'button') === kind).length + 1;
    const buttonId = useRemotes.getState().upsertButton(remote.id, {
      label: kind === 'button' ? `Button ${n}` : kind === 'label' ? 'Section' : '',
      color: 'slate',
      icon: kind === 'button' ? 'radio-button-on' : undefined,
      kind: kind === 'button' ? undefined : kind,
    });
    if (kind !== 'spacer') router.push({ pathname: '/remote/button', params: { remoteId: remote.id, buttonId } });
  };

  const note = LAYOUT_NOTES[remote.layout];
  const ready = remote.buttons.filter((b) => (b.kind ?? 'button') === 'button');

  return (
    <Screen edges={['bottom']}>
      <Stack.Screen
        options={{
          title: remote.name,
          headerRight: () => <Button compact variant={editing ? 'primary' : 'ghost'} title={editing ? 'Done' : 'Edit'} onPress={() => setEditing(!editing)} />,
        }}
      />
      <View style={styles.topRow}>
        <Tag label={layoutTag[remote.layout].label} fg={layoutTag[remote.layout].fg} bg={layoutTag[remote.layout].bg} />
        <Text style={[type.small, { flex: 1 }]}>
          {remote.category} · {ready.filter((b) => b.signal).length}/{ready.length} ready
        </Text>
        <ConnectionBadge onPress={() => router.push('/device')} />
      </View>

      {!connected && !editing ? <Banner tone="warn" icon="bluetooth" text="Not connected – buttons will not transmit." /> : null}
      {lastError ? <Banner tone="danger" icon="alert-circle" text={lastError} onClose={() => setLastError(null)} /> : null}

      {editing ? <EditHeader remoteId={remote.id} /> : null}

      {remote.buttons.length === 0 ? (
        <EmptyState icon="add-circle-outline" title="Empty remote" body={editing ? 'Use the Add section below to place buttons, headings and spacers.' : 'Tap Edit, then add buttons, headings and spacers to build your layout.'} />
      ) : (
        <RemoteSurface remote={remote} editing={editing} onButtonPress={press} />
      )}

      {note && !editing ? (
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={16} color={colors.textDim} />
          <Text style={[type.small, { flex: 1, fontSize: 12 }]}>{note}</Text>
        </View>
      ) : null}

      {editing ? (
        <>
          <Section title="Add">
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button style={{ flex: 1 }} icon="add" title="Button" onPress={() => add('button')} />
              {remote.layout === 'custom' || remote.layout === 'grid2' || remote.layout === 'grid3' ? (
                <>
                  <Button style={{ flex: 1 }} icon="text" title="Heading" onPress={() => add('label')} />
                  <Button style={{ flex: 1 }} icon="square-outline" title="Spacer" onPress={() => add('spacer')} />
                </>
              ) : null}
            </View>
          </Section>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.xl }}>
            <Button
              style={{ flex: 1 }}
              icon="copy-outline"
              title="Duplicate"
              onPress={() => {
                const copy = useRemotes.getState().duplicateRemote(remote.id);
                if (copy) router.replace({ pathname: '/remote/[id]', params: { id: copy.id, edit: '1' } });
              }}
            />
            <Button
              style={{ flex: 1 }}
              variant="danger"
              icon="trash"
              title="Delete"
              onPress={() =>
                confirm('Delete remote?', `“${remote.name}” and its ${remote.buttons.length} items will be removed from this phone.`, () => {
                  useRemotes.getState().deleteRemote(remote.id);
                  router.back();
                })
              }
            />
          </View>
        </>
      ) : (
        <Text style={[type.small, { textAlign: 'center', marginTop: space.xl, color: colors.textFaint }]}>
          Tap a button to transmit · buttons without a signal open the editor
        </Text>
      )}
    </Screen>
  );
}

function EditHeader({ remoteId }: { remoteId: string }) {
  const remote = useRemotes((s) => s.remotes.find((r) => r.id === remoteId))!;
  const update = useRemotes((s) => s.updateRemote);
  const cols = columnsFor(remote.layout, remote.columns);
  return (
    <View style={{ marginBottom: space.lg }}>
      <Field label="Name" value={remote.name} onChangeText={(name) => update(remoteId, { name })} maxLength={60} />
      <Text style={[type.label, { marginBottom: space.sm }]}>Category</Text>
      <View style={styles.wrap}>
        {REMOTE_CATEGORIES.map((c) => (
          <Chip key={c} label={c} selected={remote.category === c} onPress={() => update(remoteId, { category: c })} />
        ))}
      </View>
      <Section title="Layout">
        <View style={styles.wrap}>
          {REMOTE_LAYOUTS.map((l) => (
            <Chip
              key={l.id}
              label={l.label}
              selected={remote.layout === l.id}
              onPress={() => update(remoteId, l.id === 'custom' ? { layout: 'custom', columns: cols } : { layout: l.id })}
            />
          ))}
        </View>
        {remote.layout === 'custom' ? (
          <View style={styles.colsRow}>
            <Text style={[type.body, { flex: 1 }]}>Columns</Text>
            <Stepper value={cols} min={MIN_COLUMNS} max={MAX_COLUMNS} onChange={(columns) => update(remoteId, { columns })} />
          </View>
        ) : null}
        <Text style={[type.small, { marginTop: space.sm }]}>
          {remote.layout === 'custom'
            ? 'Tap any button to set its width (columns), shape and signal. Headings span the full row; spacers leave a gap.'
            : remote.layout === 'keyfob' || remote.layout === 'climate'
              ? 'Buttons are placed by their role (set in the button editor). Buttons without a role are added below.'
              : 'Tap a button to edit its label, colour, icon and signal.'}
        </Text>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg, gap: space.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  colsRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.md },
  note: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginTop: space.xl, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
});
