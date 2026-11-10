import { router } from 'expo-router';

import { ConnectionBadge } from '../../components/ConnectionBadge';
import { Header, Screen } from '../../components/ui';
import { LearnPanel } from '../../features/LearnPanel';

export default function LearnTab() {
  return (
    <Screen>
      <Header title="Learn" subtitle="Receive and decode 433 MHz signals" right={<ConnectionBadge onPress={() => router.push('/device')} />} />
      <LearnPanel />
    </Screen>
  );
}
