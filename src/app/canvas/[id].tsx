import { useLocalSearchParams } from 'expo-router';
import { WorkspaceScreen } from '@/screens/workspace-screen';
import { DocumentBoundary } from '@/components/document-boundary';
import type { Id } from '../../../convex/_generated/dataModel';
export default function CanvasRoute() {
  const { id, card, edit, view } = useLocalSearchParams<{ id: string; card?: string; edit?: string; view?: string }>();
  return <DocumentBoundary key={`${id}:${card ?? ''}:${view ?? ''}`}><WorkspaceScreen key={`${id}:${card ?? ''}:${view ?? ''}`} canvasId={id as Id<'canvases'>} initialCardId={card} initialView={view} focusTitle={edit === '1'} typeInPlace={edit === 'inline'} /></DocumentBoundary>;
}
