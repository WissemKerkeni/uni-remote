import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { JetBrainsMono_400Regular, JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono';
import { SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { autoConnect, initTransport } from '../services/deviceManager';
import { useRemotes } from '../store/remotesStore';
import { useSettings } from '../store/settingsStore';
import { colors, fonts } from '../theme';

function useBootstrap() {
  useEffect(() => {
    let done = false;
    const start = () => {
      if (done) return;
      done = true;
      initTransport(useSettings.getState().transportMode);
      void autoConnect();
    };
    if (useSettings.persist.hasHydrated()) start();
    const unsub = useSettings.persist.onFinishHydration(start);
    return unsub;
  }, []);
}

export default function RootLayout() {
  useBootstrap();
  // Touch the store so it starts hydrating at launch.
  useRemotes((s) => s.remotes.length);
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_600SemiBold,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });
  // Render once fonts are ready (or failed – system fonts are an acceptable fallback).
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.heading },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="remote/new" options={{ title: 'New remote', presentation: 'modal' }} />
        <Stack.Screen name="remote/[id]" options={{ title: 'Remote' }} />
        <Stack.Screen name="remote/button" options={{ title: 'Button', presentation: 'modal' }} />
        <Stack.Screen name="remote/learn" options={{ title: 'Learn signal', presentation: 'modal' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
