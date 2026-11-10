import { useLocalSearchParams } from 'expo-router';

import { Screen } from '../../components/ui';
import { LearnPanel } from '../../features/LearnPanel';

export default function AssignLearn() {
  const { remoteId, buttonId } = useLocalSearchParams<{ remoteId: string; buttonId: string }>();
  return (
    <Screen edges={['bottom']}>
      <LearnPanel assign={remoteId && buttonId ? { remoteId, buttonId } : undefined} />
    </Screen>
  );
}
