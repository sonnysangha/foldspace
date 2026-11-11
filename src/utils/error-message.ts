import { ConvexError } from 'convex/values';

/** The backend explains limits and permissions in plain words. Show that reason when there is one. */
export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | string | undefined;
    if (typeof data === 'string' && data) return data;
    if (data && typeof data === 'object' && typeof data.message === 'string' && data.message) return data.message;
  }
  return fallback;
}
