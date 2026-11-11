import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useDraftRegistry } from '@/components/canvas-history-provider';
import { CardDraftStore, type CardDraft, type DraftSnapshot } from '@/state/card-draft';

const empty: DraftSnapshot = { draft: { title: '', body: '' }, status: 'saved', localSaved: false };
const emptySubscribe = () => () => {};
const emptySnapshot = () => empty;

export function useCardDraft(userId: string, card: { _id: string; title: string; body: string } | null, commit: (id: string, draft: CardDraft) => Promise<unknown>) {
  const registry = useDraftRegistry();
  const key = card ? `foldspace:draft:${userId}:${card._id}` : '';
  const store = useMemo(() => {
    if (!key || !card) return null;
    if (!registry.has(key)) registry.set(key, new CardDraftStore({ title: card.title, body: card.body }, {
      read: () => AsyncStorage.getItem(key), write: value => AsyncStorage.setItem(key, value), remove: () => AsyncStorage.removeItem(key),
    }, values => commit(card._id, values)));
    return registry.get(key)!;
    // A stable store owns this account/card; cloud echoes arrive separately below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, key]);
  useEffect(() => {
    if (!store || !card) return;
    store.setCommit(values => commit(card._id, values));
    void store.hydrate();
    return () => { void store.flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  const serverTitle = card?.title;
  const serverBody = card?.body;
  useEffect(() => {
    if (store && serverTitle !== undefined && serverBody !== undefined) store.receiveServer({ title: serverTitle, body: serverBody });
  }, [store, serverTitle, serverBody]);
  const state = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot);
  return { ...state, change: (field: keyof CardDraft, value: string) => store?.edit(field, value), flush: store?.flush ?? (async () => true) };
}
