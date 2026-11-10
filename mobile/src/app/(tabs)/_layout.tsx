import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';

import { useDevice } from '../../store/deviceStore';
import { colors, fonts } from '../../theme';

export default function TabLayout() {
  const connected = useDevice((s) => s.status === 'connected');
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.5 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Remotes', tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color as string} /> }} />
      <Tabs.Screen name="learn" options={{ title: 'Learn', tabBarIcon: ({ color, size }) => <Ionicons name="radio" size={size} color={color as string} /> }} />
      <Tabs.Screen
        name="device"
        options={{
          title: 'Device',
          tabBarIcon: ({ color, size }) => <Ionicons name="hardware-chip" size={size} color={color as string} />,
          tabBarBadge: connected ? undefined : '!',
          tabBarBadgeStyle: { backgroundColor: colors.warn, color: colors.bg, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" size={size} color={color as string} /> }} />
    </Tabs>
  );
}
