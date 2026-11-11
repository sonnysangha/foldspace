import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery } from './_generated/server';
import { requireCard } from './model/auth';

/** The web address of a link card the caller owns, or null for any other card. */
export const target = internalQuery({
  args: { id: v.id('cards') },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { id }) => {
    const { card } = await requireCard(ctx, id);
    return card.kind === 'link' && card.url ? card.url : null;
  },
});

/** Stores what the page said about itself. A card the user has already renamed keeps its title. */
export const apply = internalMutation({
  args: { id: v.id('cards'), title: v.optional(v.string()), description: v.optional(v.string()), image: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, title, description, image }) => {
    const { card } = await requireCard(ctx, id);
    if (card.kind !== 'link' || !card.url) return null;
    const host = card.url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
    const untouched = card.title === host || card.title === 'Link';
    await ctx.db.patch(card._id, {
      ...(title && untouched ? { title: title.slice(0, 160) } : {}),
      ...(description && !card.body ? { body: description.slice(0, 300) } : {}),
      // A card with a picture needs room to show it.
      ...(image ? { linkImage: image, height: Math.max(card.height, 250) } : {}),
      updatedAt: Date.now(),
    });
    return null;
  },
});

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (text: string) => text.replace(/&(#?\w+);/g, (whole, name: string) => entities[name] ?? (name.startsWith('#x') ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith('#') ? String.fromCodePoint(Number(name.slice(1))) : whole)).replace(/\s+/g, ' ').trim();

/** Reads one <meta> value by its property or name, whichever order the attributes are in. */
function meta(html: string, key: string) {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i'))?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content) : undefined;
}

/**
 * Whether an address is safe for the server to fetch: plain http(s) to a public host name.
 * Loopback, private, link-local and other reserved addresses are refused, as are bare IP
 * literals of any kind, so a link card cannot be used to reach internal services.
 * Host names cannot be resolved to addresses in this runtime, so a public name that
 * points at a private address is not caught here.
 */
export function publicWebUrl(value: string): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.')) return null; // localhost and other single-label names
  if (host.startsWith('[') || host.includes(':')) return null; // IPv6 literals
  if (/^[\d.]+$/.test(host) || /^0x/i.test(host)) return null; // IPv4 literals, in any notation
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|test|invalid|example|onion)$/.test(host)) return null;
  return url;
}

/**
 * Fetches a link card's page and fills in its preview: the page's title, a short
 * description and its share image. Failures are silent; the card simply stays as it was.
 */
export const refresh = action({
  args: { id: v.id('cards') },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const url: string | null = await ctx.runQuery(internal.links.target, { id });
    if (!url) return null;
    try {
      // Redirects are followed by hand so every hop is checked, not just the first address.
      let current = publicWebUrl(url);
      let response: Response | null = null;
      for (let hop = 0; current && hop < 4; hop += 1) {
        response = await fetch(current.href, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FoldspaceLinkPreview/1.0)', Accept: 'text/html' } });
        const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
        if (!location) break;
        current = publicWebUrl(new URL(location, current.href).href);
        response = null;
      }
      if (!current || !response || !response.ok || !(response.headers.get('content-type') ?? '').includes('html')) return null;
      // The tags that matter sit in the page's head, so the first part of the page is enough.
      const html = (await response.text()).slice(0, 400_000);
      const title = meta(html, 'og:title') ?? meta(html, 'twitter:title') ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]) : undefined);
      const description = meta(html, 'og:description') ?? meta(html, 'description');
      const rawImage = meta(html, 'og:image') ?? meta(html, 'twitter:image');
      let image: string | undefined;
      if (rawImage) {
        // The picture is loaded by the app, not the server, but is held to the same rule.
        const resolved = publicWebUrl(new URL(rawImage, current.href).href);
        if (resolved && resolved.href.length <= 2000) image = resolved.href;
      }
      await ctx.runMutation(internal.links.apply, { id, title: title || undefined, description: description || undefined, image });
    } catch { /* An unreachable or odd page leaves the card as a plain link. */ }
    return null;
  },
});
