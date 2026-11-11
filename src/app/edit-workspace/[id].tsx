import { useQuery } from 'convex/react';
import { useLocalSearchParams } from 'expo-router';
import { api } from '../../../convex/_generated/api';
import { MissingDocument } from '@/components/document-boundary';
import { LoadingView } from '@/components/loading-view';
import { SpaceFormScreen } from '@/screens/space-form-screen';
export default function EditWorkspace() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spaces = useQuery(api.workspaces.list, {});
  if (!spaces) return <LoadingView />;
  const space = spaces.find(item => item._id === id);
  return space ? <SpaceFormScreen key={space._id} space={space} /> : <MissingDocument />;
}
