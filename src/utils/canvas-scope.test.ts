import { describe, expect, it } from 'vitest';
import { resolveCanvasScope } from './canvas-scope';

describe('canvas action scope', () => {
  const panes = { rootCanvasId: 'root', insideCanvasId: 'child', wide: true };

  it('keeps Undo and other toolbar actions with the last touched Duo pane', () => {
    expect(resolveCanvasScope({ ...panes, lastInteractedCanvasId: 'root' })).toBe('root');
    expect(resolveCanvasScope({ ...panes, lastInteractedCanvasId: 'child' })).toBe('child');
  });

  it('targets the visible child after folding even if the root was touched last', () => {
    expect(resolveCanvasScope({ ...panes, wide: false, lastInteractedCanvasId: 'root' })).toBe('child');
  });

  it('cannot keep targeting a child after its inspector closes or changes document', () => {
    expect(resolveCanvasScope({ ...panes, insideCanvasId: null, lastInteractedCanvasId: 'child' })).toBe('root');
    expect(resolveCanvasScope({ ...panes, insideCanvasId: 'another-child', lastInteractedCanvasId: 'child' })).toBe('another-child');
  });
});
