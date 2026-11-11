import { boundsOfPoints, pathToPoints, type Bounds, type Point } from './canvas-math';

export type StrokeGeometry = { path: string; points: Point[]; bounds: Bounds | null };

/** Enough for the lines of two full canvases. Beyond that the line read longest ago is dropped. */
export const STROKE_GEOMETRY_LIMIT = 1000;
const held = new Map<string, StrokeGeometry>();

/**
 * A saved line's points and the box round them. Reading the points out of a path is the
 * slow part of fitting, erasing and measuring a canvas, and a saved line never changes,
 * so each one is read once and kept under its id.
 */
export function strokeGeometry(id: string, path: string): StrokeGeometry {
  const known = held.get(id);
  if (known?.path === path) {
    // Asked for again: it becomes the most recently used.
    held.delete(id); held.set(id, known);
    return known;
  }
  const points = pathToPoints(path);
  const made = { path, points, bounds: boundsOfPoints(points) };
  held.delete(id); held.set(id, made);
  if (held.size > STROKE_GEOMETRY_LIMIT) held.delete(held.keys().next().value!);
  return made;
}
