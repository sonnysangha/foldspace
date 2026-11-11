import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

// This script creates development-only Clerk fixtures and calls the deployed
// backend with real Clerk-signed JWTs. It never logs credentials or raw errors.
const root = resolve(import.meta.dirname, '..');
const env = { ...process.env };
for (const line of (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}

const report = { checkedAt: new Date().toISOString(), deployment: '', checks: [], cleanup: [], evidence: 'Real Clerk development sessions and signed Convex JWTs; not browser or native sign-in evidence.' };
let stage = 'configuration';
let owner;
let secondary;
let ownerClient;
let board;
const sessions = [];
const runId = Date.now().toString(36);

class SafeError extends Error {
  constructor(operation, code = 'FAILED') { super(`${operation}: ${code}`); this.name = 'SafeVerificationError'; }
}

function check(name, condition) {
  assert.ok(condition, name);
  report.checks.push(name);
}

async function denied(name, operation) {
  let rejected = false;
  try { await operation(); } catch { rejected = true; }
  check(name, rejected);
}

function clerk(path, method = 'GET', data) {
  // CLI auth comes exclusively from the in-memory development env. Bodies go
  // through stdin so neither passwords nor API keys appear in process args.
  const base = ['--yes', 'clerk@latest', 'api', path, '-X', method];
  const input = data === undefined ? undefined : JSON.stringify(data);
  if (method !== 'GET') {
    const preview = spawnSync('npx', [...base, '--dry-run'], { cwd: root, env, input, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    if (preview.status !== 0) throw new SafeError(stage, 'CLERK_PREVIEW_FAILED');
  }
  const result = spawnSync('npx', [...base, ...(method === 'GET' ? [] : ['--yes'])], { cwd: root, env, input, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new SafeError(stage, 'CLERK_REQUEST_FAILED');
  try { return JSON.parse(result.stdout); } catch { throw new SafeError(stage, 'CLERK_RESPONSE_UNREADABLE'); }
}

async function createUser(email) {
  const password = `Foldspace!${randomBytes(24).toString('base64url')}aA9`;
  const user = clerk('/users', 'POST', { email_address: [email], password });
  if (!user.id?.startsWith('user_')) throw new SafeError(stage, 'USER_NOT_CREATED');
  return { id: user.id, email, password };
}

function authenticatedClient(user) {
  const session = clerk('/sessions', 'POST', { user_id: user.id });
  if (!session.id?.startsWith('sess_')) throw new SafeError(stage, 'SESSION_NOT_CREATED');
  sessions.push(session.id);
  const token = clerk(`/sessions/${session.id}/tokens/convex`, 'POST', { expires_in_seconds: 300 });
  if (!token.jwt) throw new SafeError(stage, 'JWT_NOT_CREATED');
  const claims = JSON.parse(Buffer.from(token.jwt.split('.')[1], 'base64url').toString('utf8'));
  if (claims.sub !== user.id || claims.iss !== env.CLERK_JWT_ISSUER_DOMAIN || claims.aud !== 'convex') throw new SafeError(stage, 'JWT_CLAIMS_MISMATCH');
  const client = new ConvexHttpClient(env.EXPO_PUBLIC_CONVEX_URL, { logger: false });
  client.setAuth(token.jwt);
  return { client, token: token.jwt };
}

try {
  check('Development key only', env.CLERK_SECRET_KEY?.startsWith('sk_test_'));
  const issuer = new URL(env.CLERK_JWT_ISSUER_DOMAIN);
  check('Development issuer only', issuer.hostname.endsWith('.clerk.accounts.dev'));
  const publishable = env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || env.CLERK_PUBLISHABLE_KEY;
  const pkHost = Buffer.from(publishable.replace(/^pk_test_/, ''), 'base64').toString().replace(/\$$/, '');
  check('Publishable key and issuer match', publishable.startsWith('pk_test_') && pkHost === issuer.hostname);
  report.deployment = new URL(env.EXPO_PUBLIC_CONVEX_URL).hostname;
  const anonymous = new ConvexHttpClient(env.EXPO_PUBLIC_CONVEX_URL, { logger: false });
  stage = 'unauthenticated checks';
  await denied('Anonymous workspace read rejected', () => anonymous.query(api.workspaces.list, {}));
  const noAuthUpload = await fetch(`${env.EXPO_PUBLIC_CONVEX_SITE_URL}/upload?workspaceId=invalid`, { method: 'POST' });
  check('Anonymous upload returns 401', noAuthUpload.status === 401);

  stage = 'development instance check';
  const instance = clerk('/instance');
  check('Clerk Backend API targets a development instance', instance.environment_type === 'development');
  const environmentResponse = await fetch(`${env.CLERK_JWT_ISSUER_DOMAIN}/v1/environment`);
  if (!environmentResponse.ok) throw new SafeError(stage, 'FRONTEND_ENVIRONMENT_UNAVAILABLE');
  const environment = await environmentResponse.json();
  check('Clerk test mode enabled', environment.auth_config?.test_mode === true);

  stage = 'primary development test user';
  const credentialPath = resolve(root, '.tooling/test-auth.json');
  try {
    const saved = JSON.parse(await readFile(credentialPath, 'utf8'));
    if (saved.issuer === env.CLERK_JWT_ISSUER_DOMAIN && saved.primary?.email?.endsWith('+clerk_test@example.com')) {
      const existing = clerk(`/users/${saved.primary.id}`);
      if (existing.id === saved.primary.id) owner = saved.primary;
    }
  } catch { /* A missing or stale local test fixture can be recreated. */ }
  if (!owner) {
    owner = await createUser(`foldspace-native-${runId}+clerk_test@example.com`);
    await mkdir(resolve(root, '.tooling'), { recursive: true });
    await writeFile(credentialPath, JSON.stringify({ issuer: env.CLERK_JWT_ISSUER_DOMAIN, primary: owner }, null, 2) + '\n', { mode: 0o600 });
  }
  await chmod(credentialPath, 0o600);
  stage = 'secondary development test user';
  secondary = await createUser(`foldspace-isolation-${runId}+clerk_test@example.com`);

  stage = 'real Clerk JWT minting';
  const ownerSession = authenticatedClient(owner);
  ownerClient = ownerSession.client;
  const otherSession = authenticatedClient(secondary);
  const otherClient = otherSession.client;
  check('Clerk signed tokens have correct issuer audience and subject', true);

  stage = 'owned workspace lifecycle';
  board = await ownerClient.mutation(api.workspaces.create, { title: `Live backend smoke ${runId}`, color: '#478C8A' });
  const rootCanvas = await ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId });
  check('Owner creates and reads workspace root', rootCanvas.workspace._id === board._id);
  const card = await ownerClient.mutation(api.cards.create, { canvasId: board.rootCanvasId, kind: 'note', title: 'Live note', body: 'Clerk JWT integration', color: '#FFF0BF', x: 100, y: 120, width: 250, height: 180 });
  const nested = await ownerClient.mutation(api.cards.create, { canvasId: card.childCanvasId, kind: 'note', title: 'Nested note', body: 'Real persisted child canvas', color: '#DCECE7', x: 80, y: 80, width: 240, height: 180 });
  await ownerClient.mutation(api.cards.update, { id: card._id, title: 'Updated live note', body: 'Saved and read from the cloud', x: -50 });
  await ownerClient.mutation(api.workspaces.rename, { id: board._id, title: 'Verified live workspace' });
  const nestedCanvas = await ownerClient.query(api.canvases.get, { canvasId: nested.childCanvasId });
  check('Nested canvas and breadcrumb rename persisted', nestedCanvas.breadcrumbs.map(item => item.title).join('/') === 'Verified live workspace/Updated live note/Nested note');
  const savedCard = (await ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards.find(item => item._id === card._id);
  check('Note body and drag position persisted', savedCard?.body === 'Saved and read from the cloud' && savedCard.x === -50);
  const cover = await ownerClient.query(api.canvases.preview, { canvasId: card.childCanvasId });
  check('Owner preview reads real nested content', cover.cardCount === 1 && cover.cards[0].title === 'Nested note');
  await denied('Anonymous cannot read canvas previews', () => anonymous.query(api.canvases.preview, { canvasId: card.childCanvasId }));

  stage = 'drawing persistence';
  const path = 'M 10 20 Q 50 90 120 20';
  const strokeId = await ownerClient.mutation(api.strokes.create, { canvasId: board.rootCanvasId, path, color: '#102030', width: 4 });
  check('Vector drawing persisted', (await ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId })).strokes.some(stroke => stroke._id === strokeId && stroke.path === path));
  await ownerClient.mutation(api.strokes.remove, { id: strokeId });
  await ownerClient.mutation(api.strokes.restore, { id: strokeId });
  check('Drawing erase and undo persisted', (await ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId })).strokes.some(stroke => stroke._id === strokeId));

  stage = 'cross-user authorization';
  check('Second user cannot list owner workspace', !(await otherClient.query(api.workspaces.list, {})).some(item => item._id === board._id));
  await denied('Second user cannot read root', () => otherClient.query(api.canvases.get, { canvasId: board.rootCanvasId }));
  await denied('Second user cannot read nested canvas', () => otherClient.query(api.canvases.get, { canvasId: nested.childCanvasId }));
  await denied('Second user cannot read canvas previews', () => otherClient.query(api.canvases.preview, { canvasId: card.childCanvasId }));
  await denied('Second user cannot edit note', () => otherClient.mutation(api.cards.update, { id: card._id, body: 'Unauthorized change' }));
  await denied('Second user cannot erase drawing', () => otherClient.mutation(api.strokes.remove, { id: strokeId }));
  await denied('Second user cannot delete workspace', () => otherClient.mutation(api.workspaces.remove, { id: board._id }));
  const foreignUpload = await fetch(`${env.EXPO_PUBLIC_CONVEX_SITE_URL}/upload?workspaceId=${board._id}`, { method: 'POST', headers: { Authorization: `Bearer ${otherSession.token}` } });
  check('Second user upload rejected with 404', foreignUpload.status === 404);

  stage = 'audit feature verification';
  await ownerClient.mutation(api.workspaces.setPinned, { id: board._id, pinned: true });
  check('Pinned space persisted', (await ownerClient.query(api.workspaces.list, {})).find(item => item._id === board._id)?.pinned === true);
  await denied('Second user cannot pin another workspace', () => otherClient.mutation(api.workspaces.setPinned, { id: board._id, pinned: false }));
  const found = await ownerClient.query(api.search.cards, { workspaceId: board._id, text: 'persisted' });
  check('Indexed body search finds nested card', found.some(item => item._id === nested._id));
  await denied('Second user cannot search private workspace', () => otherClient.query(api.search.cards, { workspaceId: board._id, text: 'note' }));
  await denied('Anonymous cannot search private workspace', () => anonymous.query(api.search.cards, { workspaceId: board._id, text: 'note' }));
  const beforeEdit = await ownerClient.mutation(api.cards.edit, { id: card._id, width: 380, height: 300, x: 25 });
  check('Card edit returns exact previous geometry', beforeEdit.width === 250 && beforeEdit.x === -50);
  await denied('Second user cannot resize another card', () => otherClient.mutation(api.cards.edit, { id: card._id, width: 280 }));
  const erased = await ownerClient.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [strokeId, strokeId], deleted: true });
  check('Batch eraser deduplicates IDs', erased.length === 1 && erased[0] === strokeId);
  check('Repeated batch erase is a no-op', (await ownerClient.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [strokeId], deleted: true })).length === 0);
  await ownerClient.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: erased, deleted: false });
  check('Batch erase undo restores saved ink', (await ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId })).strokes.some(item => item._id === strokeId));
  await denied('Second user cannot batch erase private ink', () => otherClient.mutation(api.strokes.setDeleted, { canvasId: board.rootCanvasId, ids: [strokeId], deleted: true }));

  stage = 'owned image upload';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jCTkAAAAASUVORK5CYII=', 'base64');
  const upload = await fetch(`${env.EXPO_PUBLIC_CONVEX_SITE_URL}/upload?workspaceId=${board._id}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerSession.token}`, 'Content-Type': 'image/png' }, body: png });
  check('Owner image upload accepted', upload.status === 200);
  const { storageId } = await upload.json();
  await ownerClient.mutation(api.cards.create, { canvasId: board.rootCanvasId, kind: 'image', title: 'Smoke image', body: '', color: '#FFFFFF', x: 400, y: 120, width: 180, height: 180, imageStorageId: storageId });
  const imageCard = (await ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId })).cards.find(item => item.kind === 'image');
  check('Owner query resolves stored image URL', Boolean(imageCard?.imageUrl));
  check('Stored image is retrievable', (await fetch(imageCard.imageUrl)).status === 200);

  stage = 'nested deletion';
  await ownerClient.mutation(api.cards.remove, { id: card._id });
  await denied('Deleted ancestor blocks nested canvas', () => ownerClient.query(api.canvases.get, { canvasId: nested.childCanvasId }));
  await denied('Deleted ancestor blocks canvas previews', () => ownerClient.query(api.canvases.preview, { canvasId: card.childCanvasId }));
  check('Deleted ancestor removed from search results', !(await ownerClient.query(api.search.cards, { workspaceId: board._id, text: 'persisted' })).some(item => item._id === nested._id));
  await denied('Second user cannot restore a deleted card', () => otherClient.mutation(api.cards.restore, { id: card._id }));
  await ownerClient.mutation(api.cards.restore, { id: card._id });
  check('Card restore brings its nested content back', (await ownerClient.query(api.canvases.get, { canvasId: card.childCanvasId })).cards.some(item => item._id === nested._id));
  await ownerClient.mutation(api.workspaces.remove, { id: board._id });
  await denied('Deleted workspace blocks root canvas', () => ownerClient.query(api.canvases.get, { canvasId: board.rootCanvasId }));
  check('Deleted workspace removed from owner list', !(await ownerClient.query(api.workspaces.list, {})).some(item => item._id === board._id));
  report.cleanup.push('Smoke workspace soft-deleted and absent from owner list.');
  board = undefined;
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = { stage, code: error instanceof SafeError ? error.message.split(': ').at(-1) : 'ASSERTION_OR_REQUEST_FAILED' };
} finally {
  if (board && ownerClient) {
    try { await ownerClient.mutation(api.workspaces.remove, { id: board._id }); report.cleanup.push('Incomplete smoke workspace soft-deleted.'); } catch { report.cleanup.push('Smoke workspace cleanup needs retry.'); }
  }
  for (const id of sessions) {
    try { clerk(`/sessions/${id}/revoke`, 'POST', {}); report.cleanup.push('Smoke session revoked.'); } catch { report.cleanup.push('Smoke session revocation needs retry.'); }
  }
  if (secondary) {
    try { clerk(`/users/${secondary.id}`, 'DELETE'); report.cleanup.push('Secondary test user deleted.'); } catch { report.cleanup.push('Secondary test user cleanup needs retry.'); }
  }
  if (owner) report.cleanup.push('Primary development test user retained for native verification; password stored only in ignored mode-600 .tooling/test-auth.json.');
  await mkdir(resolve(root, 'docs'), { recursive: true });
  const lines = [
    '# Backend verification', '', `Checked: ${report.checkedAt}`, `Deployment: ${report.deployment}`, `Result: **${report.status}**`, '',
    report.evidence, '', '## Checks', '', ...report.checks.map(name => `- Passed: ${name}`), '', '## Cleanup', '', ...report.cleanup.map(name => `- ${name}`), '',
    ...(report.failure ? [`Failure stage: ${report.failure.stage}; code: ${report.failure.code}.`, ''] : []),
    '## Scope', '', 'This confirms the deployed backend accepts real Clerk-issued development JWTs and enforces ownership. It does not establish native AuthView, physical-device, or production behavior. Workspace deletion uses the application’s soft-delete model; unreachable tombstoned fixture records and a tiny test image remain in development storage.', '',
    '## Reproduce', '', '`node scripts/verify-live-backend.mjs`', '',
    'The script refuses live Clerk keys or non-development issuers, requires Clerk test mode, uses reserved test email addresses, previews Clerk mutations through the CLI, and suppresses tokens, passwords, keys, and raw provider errors. It retains one development test account for the native smoke test.', '',
    'References: [Clerk test sessions](https://clerk.com/docs/guides/development/testing/overview), [reserved test email addresses](https://clerk.com/docs/guides/development/testing/test-emails-and-phones), [Convex and Clerk](https://docs.convex.dev/auth/clerk).', '',
  ];
  await writeFile(resolve(root, 'docs/backend-verification.md'), lines.join('\n'));
  console.log(JSON.stringify({ status: report.status, checks: report.checks.length, failure: report.failure ?? null, report: 'docs/backend-verification.md', nativeTestEmail: owner?.email ?? null, cleanup: report.cleanup }));
  if (report.status !== 'passed') process.exitCode = 1;
}
