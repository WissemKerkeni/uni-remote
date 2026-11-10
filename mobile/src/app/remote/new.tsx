// New remote: name + template picker (Stitch "New Remote – Template Picker").
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LayoutPreview } from '../../components/remote/LayoutPreview';
import { Button, Field, Tag } from '../../components/ui';
import { TEMPLATES } from '../../domain/templates';
import { useRemotes } from '../../store/remotesStore';
import { colors, radius, space, type } from '../../theme';

export default function NewRemote() {
  const create = useRemotes((s) => s.createRemote);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('general4');

  const submit = () => {
    const t = TEMPLATES.find((x) => x.id === templateId)!;
    const remote = create({
      name: name.trim() || t.title,
      category: t.category,
      layout: t.layout,
      columns: t.columns,
      buttons: t.buttons,
    });
    router.replace({ pathname: '/remote/[id]', params: { id: remote.id, edit: t.id === 'custom' ? '1' : '0' } });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Field label="Remote name" value={name} onChangeText={setName} placeholder="e.g. Living room" maxLength={60} />

        <View style={styles.sectionHead}>
          <Text style={type.label}>Choose a layout</Text>
          <Tag label={`${TEMPLATES.length} templates`} />
        </View>

        {TEMPLATES.map((t) => {
          const selected = t.id === templateId;
          return (
            <Pressable
              key={t.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={t.title}
              onPress={() => setTemplateId(t.id)}
              style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && { opacity: 0.85 }]}
            >
              <LayoutPreview layout={t.layout} columns={t.columns} buttons={t.buttons} width={92} />
              <View style={{ flex: 1, gap: 4, paddingRight: 24 }}>
                <Text style={[type.h3, selected && { color: colors.accent }]}>{t.title}</Text>
                <Text style={[type.small, { fontSize: 12.5, lineHeight: 17 }]}>{t.description}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  <Tag label={t.id === 'custom' ? 'blank grid' : `${t.buttons.filter((b) => (b.kind ?? 'button') === 'button').length} buttons`} />
                  {t.note ? <Tag label={t.note.split(' – ')[0]} fg={colors.warn} bg={colors.warnDim} /> : null}
                </View>
              </View>
              <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <Ionicons name="checkmark" size={14} color={colors.bg} /> : null}</View>
            </Pressable>
          );
        })}
        {TEMPLATES.find((t) => t.id === templateId)?.note ? (
          <View style={styles.note}>
            <Ionicons name="information-circle-outline" size={16} color={colors.warn} />
            <Text style={[type.small, { flex: 1, fontSize: 12 }]}>{TEMPLATES.find((t) => t.id === templateId)!.note}</Text>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button variant="primary" icon="arrow-forward" title="Create remote" onPress={submit} />
        <Text style={[type.small, { textAlign: 'center', marginTop: space.sm, fontSize: 12 }]}>You teach each button its signal in the next step</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.sm, marginBottom: space.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, marginBottom: space.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cardSelected: { borderColor: colors.accent, borderWidth: 1.5, backgroundColor: '#11201C' },
  radio: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: colors.textFaint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  note: { flexDirection: 'row', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.warnDim, borderWidth: 1, borderColor: colors.warn + '44' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, paddingBottom: space.xl, backgroundColor: colors.bg + 'F2', borderTopWidth: 1, borderTopColor: colors.border },
});

