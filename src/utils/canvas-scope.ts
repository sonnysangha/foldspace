/** On a phone the visible document wins; on Duo the last touched document wins. */
export function resolveCanvasScope({ rootCanvasId, insideCanvasId, lastInteractedCanvasId, wide }: {
  rootCanvasId: string;
  insideCanvasId: string | null;
  lastInteractedCanvasId: string;
  wide: boolean;
}) {
  if (!insideCanvasId) return rootCanvasId;
  if (!wide) return insideCanvasId;
  return lastInteractedCanvasId === rootCanvasId ? rootCanvasId : insideCanvasId;
}
