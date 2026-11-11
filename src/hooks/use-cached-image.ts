import { FilterMode, MipmapMode, Skia, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';

import { fitWithin, LruCache } from '@/utils/lru';

/**
 * A photo on a card is a few hundred points wide, and a thumbnail far smaller, so a picture
 * is kept no larger than this on its longer side. That stays sharp well past normal zoom
 * and takes less than half the memory of the 1800-pixel original.
 */
const LONGEST_SIDE = 1200;
/** About thirty pictures at full kept size. Past this the ones drawn longest ago are let go. */
const MEMORY_LIMIT = 128 * 1024 * 1024;

/**
 * Photos drawn on the canvas are decoded once and kept, most recently used first, up to
 * the limit above. Each one's file stays in expo-image's disk cache, so stepping in and
 * out of spaces, or relaunching, does not download the same photo again; one that was let
 * go is read back from that file.
 */
const decoded = new LruCache<string, SkImage>(MEMORY_LIMIT, image => image.width() * image.height() * 4);
const loading = new Map<string, Promise<SkImage | null>>();

/** The picture at the size it is kept at. If it cannot be redrawn smaller, it is kept as it came. */
function downscaled(image: SkImage): SkImage {
  const width = image.width(), height = image.height();
  const size = fitWithin(width, height, LONGEST_SIDE);
  if (size.width === width && size.height === height) return image;
  try {
    const surface = Skia.Surface.Make(size.width, size.height);
    if (!surface) return image;
    surface.getCanvas().drawImageRectOptions(image, Skia.XYWHRect(0, 0, width, height), Skia.XYWHRect(0, 0, size.width, size.height), FilterMode.Linear, MipmapMode.Linear);
    surface.flush();
    const small = surface.makeImageSnapshot();
    // The surface and the full-size original are no longer needed; their pixels are released now, not whenever memory is next tidied.
    try { surface.dispose(); image.dispose(); } catch { /* Left for the garbage collector. */ }
    return small;
  } catch { return image; }
}

async function load(url: string): Promise<SkImage | null> {
  let source = url;
  try {
    // Download to disk once; later launches read the file instead of the network.
    // A stalled download must not hold the picture back, so the wait is bounded.
    const stored = await Promise.race([Image.prefetch(url, 'disk'), new Promise<false>(resolve => setTimeout(() => resolve(false), 6000))]);
    const path = stored ? await Image.getCachePathAsync(url) : null;
    if (path) source = path.startsWith('file://') ? path : `file://${path}`;
  } catch { /* Fall back to reading straight from the network. */ }
  const read = async (uri: string) => Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(uri));
  let image = await read(source).catch(() => null);
  if (!image && source !== url) image = await read(url).catch(() => null);
  if (!image) return null;
  const kept = downscaled(image);
  decoded.set(url, kept);
  return kept;
}

export function useCachedImage(url: string | null | undefined): SkImage | null {
  // The image is held in state, tagged with its address, so a finished load re-renders
  // the card. Reading the cache during render alone would be memoised away.
  const [loaded, setLoaded] = useState<{ url: string; image: SkImage } | null>(() => {
    const image = url ? decoded.get(url) : undefined;
    return url && image ? { url, image } : null;
  });
  useEffect(() => {
    if (!url) return;
    let active = true;
    const ready = decoded.get(url);
    let pending = ready ? Promise.resolve<SkImage | null>(ready) : loading.get(url);
    if (!pending) {
      pending = load(url).finally(() => loading.delete(url));
      loading.set(url, pending);
    }
    void pending.then(image => { if (active && image) setLoaded({ url, image }); });
    return () => { active = false; };
  }, [url]);
  return url && loaded?.url === url ? loaded.image : null;
}
