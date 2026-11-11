import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CanvasHistory } from '@/state/canvas-history';
import { CardDraftStore } from '@/state/card-draft';

const HistoryContext = createContext<Map<string, CanvasHistory> | null>(null);
const DraftContext = createContext<Map<string, CardDraftStore> | null>(null);
/** Mounted inside AuthGate: histories disappear when the signed-in session ends. */
export function CanvasHistoryProvider({ children }: { children: ReactNode }) {
  const histories = useState(() => new Map<string, CanvasHistory>())[0];
  const drafts = useState(() => new Map<string, CardDraftStore>())[0];
  useEffect(() => { const stores = drafts; return () => { stores.forEach(store => store.stop()); }; }, [drafts]);
  return <HistoryContext.Provider value={histories}><DraftContext.Provider value={drafts}>{children}</DraftContext.Provider></HistoryContext.Provider>;
}
export function useDraftRegistry() {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error('Drafts require their session provider.');
  return drafts;
}
export function useCanvasHistory(canvasId: string) {
  const histories = useHistoryRegistry();
  const history = getCanvasHistory(histories, canvasId);
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot, history.getSnapshot);
  return { history, ...state };
}
export function useHistoryRegistry() {
  const histories = useContext(HistoryContext);
  if (!histories) throw new Error('Canvas history requires its session provider.');
  return histories;
}
export function getCanvasHistory(registry: Map<string, CanvasHistory>, id: string) {
  if (!registry.has(id)) registry.set(id, new CanvasHistory());
  return registry.get(id)!;
}
