import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { requireIdentity } from './model/auth';

const http = httpRouter();
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Content-Type': 'application/json',
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function recognizedImage(bytes: Uint8Array, type: string) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (type === 'image/webp') return String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  // A voice note: an MPEG-4 audio file, which carries 'ftyp' after its first four bytes.
  if (type === 'audio/mp4') return String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
  return false;
}

http.route({
  path: '/upload', method: 'OPTIONS',
  handler: httpAction(async () => new Response(null, { status: 204, headers })),
});

http.route({
  path: '/upload', method: 'POST',
  handler: httpAction(async (ctx, request) => {
    if (!(await ctx.auth.getUserIdentity())) return response({ error: 'Sign in before uploading.' }, 401);
    const rawWorkspaceId = new URL(request.url).searchParams.get('workspaceId');
    if (!rawWorkspaceId) return response({ error: 'A workspace is required.' }, 400);
    const workspaceId = rawWorkspaceId as Id<'workspaces'>;
    try {
      // runQuery validates the untrusted string as a real workspace ID.
      await ctx.runQuery(internal.storage.authorizeUpload, { workspaceId });
    } catch {
      return response({ error: 'Workspace unavailable.' }, 404);
    }
    const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'audio/mp4'].includes(contentType)) return response({ error: 'Use a JPEG, PNG, or WebP image, or an M4A recording.' }, 415);
    const length = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES) return response({ error: 'Files must be smaller than 12 MB.' }, 413);
    const blob = await request.blob();
    if (!blob.size || blob.size > MAX_IMAGE_BYTES) return response({ error: 'Files must be between 1 byte and 12 MB.' }, 413);
    if (!recognizedImage(new Uint8Array(await blob.slice(0, 16).arrayBuffer()), contentType)) return response({ error: 'The file does not match its type.' }, 415);
    let storageId: Id<'_storage'> | null = null;
    try {
      await requireIdentity(ctx);
      storageId = await ctx.storage.store(new Blob([blob], { type: contentType }));
      // Recheck ownership after transfer before accepting the uploaded file.
      await ctx.runMutation(internal.storage.registerUpload, { workspaceId, storageId, contentType, size: blob.size });
      return response({ storageId });
    } catch {
      if (storageId) await ctx.storage.delete(storageId);
      return response({ error: 'Could not save this file. Please retry.' }, 400);
    }
  }),
});

export default http;
