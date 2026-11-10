// Platform file I/O for profile export/import (expo-file-system SDK 58 class API).
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export async function shareJsonFile(fileName: string, content: string) {
  if (Platform.OS === 'web') {
    // Browser download fallback.
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Export UniRemote profiles', UTI: 'public.json' });
}

/** Lets the user pick a JSON file; resolves null when cancelled. */
export async function pickJsonFile(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (asset.size && asset.size > 2_000_000) throw new Error('File is too large (max 2 MB).');
  if (Platform.OS === 'web') {
    const r = await fetch(asset.uri);
    return await r.text();
  }
  return await new File(asset.uri).text();
}
