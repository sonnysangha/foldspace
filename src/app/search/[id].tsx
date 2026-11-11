import { useLocalSearchParams } from 'expo-router';
import type { Id } from '../../../convex/_generated/dataModel';
import { DocumentBoundary } from '@/components/document-boundary';
import { SearchScreen } from '@/screens/search-screen';
export default function SearchRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <DocumentBoundary key={id}><SearchScreen workspaceId={id as Id<'workspaces'>} /></DocumentBoundary>;
}
