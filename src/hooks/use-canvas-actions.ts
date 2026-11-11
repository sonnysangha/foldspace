import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { getCanvasHistory, useCanvasHistory, useHistoryRegistry } from '@/components/canvas-history-provider';
import type { CanvasCard, NewStroke } from '@/types/canvas';

type CardInput = Pick<CanvasCard, 'kind' | 'title' | 'body' | 'color' | 'x' | 'y' | 'width' | 'height'> & { imageStorageId?: Id<'_storage'>; canvasId?: Id<'canvases'>; url?: string; duration?: number; latitude?: number; longitude?: number };
export type CardPatch = Partial<Pick<CanvasCard, 'color' | 'x' | 'y' | 'width' | 'height'>>;

export function useCanvasActions(canvasId: Id<'canvases'>) {
  const historyState = useCanvasHistory(canvasId);
  const histories = useHistoryRegistry();
  const create = useMutation(api.cards.create);
  const editCard = useMutation(api.cards.edit);
  const updateCard = useMutation(api.cards.update);
  const removeCard = useMutation(api.cards.remove);
  const restoreCard = useMutation(api.cards.restore);
  const createStroke = useMutation(api.strokes.create);
  const setDeleted = useMutation(api.strokes.setDeleted);
  const toggleConnector = useMutation(api.connectors.toggle);
  const history = historyState.history;
  return {
    ...historyState,
    async create(values: CardInput) {
      const target = values.canvasId ?? canvasId;
      return getCanvasHistory(histories, target).commit('Add card', async () => {
        const result = await create({ ...values, canvasId: target });
        return { value: result, undo: () => removeCard({ id: result._id }), redo: () => restoreCard({ id: result._id }) };
      });
    },
    async edit(id: string, patch: CardPatch, label = 'Move card') {
      return history.commit(label, async () => {
        const previous = await editCard({ id: id as Id<'cards'>, ...patch });
        const before = Object.fromEntries(Object.keys(patch).map(key => [key, previous[key as keyof typeof previous]])) as CardPatch;
        return { value: null, skip: Object.keys(patch).every(key => patch[key as keyof CardPatch] === previous[key as keyof typeof previous]), undo: () => updateCard({ id: id as Id<'cards'>, ...before }), redo: () => updateCard({ id: id as Id<'cards'>, ...patch }) };
      });
    },
    async remove(id: string) {
      return history.commit('Delete card', async () => {
        await removeCard({ id: id as Id<'cards'> });
        return { value: null, undo: () => restoreCard({ id: id as Id<'cards'> }), redo: () => removeCard({ id: id as Id<'cards'> }) };
      });
    },
    /** Joins two cards, or removes the connector they already share. Undo toggles it back. */
    async connect(fromCardId: string, toCardId: string) {
      const ends = { canvasId, fromCardId: fromCardId as Id<'cards'>, toCardId: toCardId as Id<'cards'> };
      return history.commit('Connect cards', async () => {
        const value = await toggleConnector(ends);
        return { value, undo: () => toggleConnector(ends), redo: () => toggleConnector(ends) };
      });
    },
    async draw(stroke: NewStroke) {
      return history.commit('Draw ink', async () => {
        const id = await createStroke({ canvasId, ...stroke });
        return { value: id, undo: () => setDeleted({ canvasId, ids: [id], deleted: true }), redo: () => setDeleted({ canvasId, ids: [id], deleted: false }) };
      });
    },
    async erase(ids: string[]) {
      return history.commit('Erase ink', async () => {
        const changed = await setDeleted({ canvasId, ids: ids as Id<'strokes'>[], deleted: true });
        return { value: changed, skip: !changed.length, undo: () => setDeleted({ canvasId, ids: changed, deleted: false }), redo: () => setDeleted({ canvasId, ids: changed, deleted: true }) };
      });
    },
  };
}
