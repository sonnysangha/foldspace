import { useLocalSearchParams } from 'expo-router';

import type { Id } from '../../../convex/_generated/dataModel';
import { ShareScreen } from '@/screens/share-screen';

export default function ShareRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ShareScreen key={id} workspaceId={id as Id<'workspaces'>} />;
}
