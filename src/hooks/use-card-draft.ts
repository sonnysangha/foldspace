import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { getDraftStore, useDraftRegistry } from '@/components/canvas-history-provider';
import { CardDraftStore, type CardDraft, type DraftSnapshot } from '@/state/card-draft';

const empty: DraftSnapshot = { draft: { title: '', body: '' }, status: 'saved', localSaved: false };
/** Typing is copied to the device once it pauses this long, rather than on every keystroke. */
const LOCAL_WRITE_PAUSE = 300;
const emptySubscribe = () => () => {};
const emptySnapshot = () => empty;

export function useCardDraft(userId: string, card: { _id: string; title: string; body: string } | null, commit: (id: string, draft: CardDraft) => Promise<unknown>) {
  const registry = useDraftRegistry();
  const key = card ? `foldspace:draft:${userId}:${card._id}` : '';
  // A stable store owns this account/card; cloud echoes arrive separately below.
  const store = key && card ? getDraftStore(registry, key, () => new CardDraftStore({ title: card.title, body: card.body }, {
    read: () => AsyncStorage.getItem(key), write: value => AsyncStorage.setItem(key, value), remove: () => AsyncStorage.removeItem(key),
  }, values => commit(card._id, values), LOCAL_WRITE_PAUSE)) : null;
  const cardId = card?._id;
  const latestCommit = useRef(commit);
  useLayoutEffect(() => { latestCommit.current = commit; });
  useEffect(() => {
    if (!store || cardId === undefined) return;
    store.setCommit(values => latestCommit.current(cardId, values));
    void store.hydrate();
    return () => { void store.flush(); };
  }, [store, cardId]);
  const serverTitle = card?.title;
  const serverBody = card?.body;
  useEffect(() => {
    if (store && serverTitle !== undefined && serverBody !== undefined) store.receiveServer({ title: serverTitle, body: serverBody });
  }, [store, serverTitle, serverBody]);
  const state = useSyncExternalStore(store?.subscribe ?? emptySubscribe, store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot);
  return { ...state, change: (field: keyof CardDraft, value: string) => store?.edit(field, value), flush: store?.flush ?? (async () => true) };
}
