import { Skia, type SkImage } from '@shopify/react-native-skia';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';

/**
 * Photos drawn on the canvas are decoded once and kept. A decoded image is held in memory
 * for the life of the app, and its file is kept in expo-image's disk cache, so stepping in
 * and out of spaces, or relaunching, does not download or decode the same photo again.
 */
const decoded = new Map<string, SkImage>();
const loading = new Map<string, Promise<SkImage | null>>();

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
  if (image) decoded.set(url, image);
  return image;
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
