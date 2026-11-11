import { useLocalSearchParams } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { WorkspaceScreen } from '@/screens/workspace-screen';
import { DocumentBoundary, MissingDocument } from '@/components/document-boundary';
import { LoadingView } from '@/components/loading-view';

export default function WorkspaceRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const spaces = useQuery(api.workspaces.list, {});
  if (spaces === undefined) return <LoadingView label="Opening your space…" />;
  const space = spaces.find((item) => item._id === id);
  if (!space) return <MissingDocument />;
  return <DocumentBoundary key={space.rootCanvasId}><WorkspaceScreen key={space.rootCanvasId} canvasId={space.rootCanvasId} /></DocumentBoundary>;
}
