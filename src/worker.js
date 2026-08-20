'use strict';

/* Cadence — Cloudflare Worker entrypoint.
 *
 * Static files (public/) are served by the Workers Assets binding before this
 * script ever runs; only "/" and everything under "/api" reach fetch() below
 * (see wrangler.toml's assets.run_worker_first). D1 replaces the old SQLite
 * file as the persistence layer, so history survives redeploys and is no
 * longer tied to a single instance's disk. */

const store = require('./db');
const { analytics } = require('./analytics');
const auth = require('./auth');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/* ---------------------------------------------------------------- *
 * auth — name + PIN, mapped to a workspace. No email, no sessions to
 * manage: a successful login just hands back the workspace id, which the
 * client adopts the same way it always adopted one.
 * ---------------------------------------------------------------- */

async function handleRegister(request, env) {
  const body = await readJson(request);
  const name = auth.validateName(body.name);
  if (!name) return json({ error: 'bad_name' }, 400);
  const pin = auth.validatePin(body.pin);
  if (!pin) return json({ error: 'bad_pin' }, 400);

  if (await store.findUserByName(env.DB, name)) return json({ error: 'name_taken' }, 409);

  const workspaceId = await store.createWorkspace(env.DB);
  const user = await store.createUser(env.DB, name, await auth.hashPin(pin), workspaceId);
  return json({ name: user.name, workspaceId: user.workspaceId }, 201);
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  const name = auth.validateName(body.name);
  if (!name) return json({ error: 'bad_name' }, 400);
  const pin = auth.validatePin(body.pin);
  if (!pin) return json({ error: 'bad_pin' }, 400);

  const user = await store.findUserByName(env.DB, name);
  if (!user) return json({ error: 'no_such_user' }, 404);
  if (!(await auth.verifyPin(pin, user.pinHash))) return json({ error: 'bad_credentials' }, 401);
  return json({ name: user.name, workspaceId: user.workspaceId });
}

/* ---------------------------------------------------------------- *
 * workspace routes
 * ---------------------------------------------------------------- */

/** Full pull. `since` lets a returning tab fetch only new session events. */
async function handleState(env, workspaceId, url) {
  const since = Number(url.searchParams.get('since')) || 0;
  const settings = await store.getSettings(env.DB, workspaceId);
  return json({
    workspaceId,
    serverTime: Date.now(),
    sessions: await store.getSessions(env.DB, workspaceId, since),
    tasks: await store.getTasks(env.DB, workspaceId),
    settings: settings ? settings.payload : null,
    settingsUpdatedAt: settings ? settings.updatedAt : 0,
  });
}

/** Append-only session push. Idempotent: replaying the same client-generated
 *  ids is a no-op, so an unreliable network can retry without double-counting. */
async function handleSessions(request, env, workspaceId) {
  const body = await readJson(request);
  const raw = Array.isArray(body.sessions) ? body.sessions : [];
  if (raw.length > 500) return json({ error: 'too_many_sessions' }, 413);

  const clean = [];
  for (const s of raw) {
    if (!s || !UUID_RE.test(String(s.id || ''))) continue;
    if (!['focus', 'short', 'long'].includes(s.mode)) continue;
    if (!DATE_RE.test(String(s.localDate || ''))) continue;
    const seconds = Number(s.seconds);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 24 * 3600) continue;
    clean.push({
      id: String(s.id),
      mode: s.mode,
      seconds,
      planned: Number(s.planned) || 0,
      completed: s.completed !== false,
      taskId: s.taskId ? String(s.taskId).slice(0, 64) : null,
      category: s.category ? String(s.category).slice(0, 80) : null,
      startedAt: Number(s.startedAt) || Date.now(),
      endedAt: Number(s.endedAt) || Date.now(),
      localDate: String(s.localDate),
      deviceId: s.deviceId ? String(s.deviceId).slice(0, 64) : null,
    });
  }

  const written = await store.insertSessions(env.DB, workspaceId, clean);
  return json({ accepted: clean.length, written, rejected: raw.length - clean.length });
}

async function handleTasks(request, env, workspaceId) {
  const body = await readJson(request);
  const raw = Array.isArray(body.tasks) ? body.tasks : [];
  if (raw.length > 1000) return json({ error: 'too_many_tasks' }, 413);
  await store.putTasks(
    env.DB,
    workspaceId,
    raw.filter((t) => t && t.id != null)
  );
  return json({ tasks: await store.getTasks(env.DB, workspaceId) });
}

async function handleSettings(request, env, workspaceId) {
  const body = await readJson(request);
  const payload = body.settings;
  if (!payload || typeof payload !== 'object') return json({ error: 'bad_settings' }, 400);
  await store.putSettings(env.DB, workspaceId, payload, body.updatedAt);
  const saved = await store.getSettings(env.DB, workspaceId);
  return json({ settings: saved ? saved.payload : null, updatedAt: saved ? saved.updatedAt : 0 });
}

async function handleAnalytics(env, workspaceId, url) {
  const today = url.searchParams.get('today') || '';
  if (!DATE_RE.test(today)) return json({ error: 'bad_today' }, 400);
  return json(await analytics(env.DB, workspaceId, today, { goal: url.searchParams.get('goal') }));
}

/* ---------------------------------------------------------------- *
 * router
 * ---------------------------------------------------------------- */

const WORKSPACE_ROUTE = /^\/api\/workspaces\/([^/]+)\/(state|sessions|tasks|settings|analytics)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === '/' && method === 'GET') {
        return env.ASSETS.fetch(new URL('/Pomodoro.dc.html', url));
      }

      if (pathname === '/favicon.ico') return new Response(null, { status: 204 });

      if (pathname === '/api/health' && method === 'GET') {
        return json({ ok: true, at: Date.now() });
      }

      if (pathname === '/api/auth/register' && method === 'POST') return handleRegister(request, env);
      if (pathname === '/api/auth/login' && method === 'POST') return handleLogin(request, env);

      if (pathname === '/api/workspaces' && method === 'POST') {
        return json({ id: await store.createWorkspace(env.DB) }, 201);
      }

      const wsMatch = pathname.match(WORKSPACE_ROUTE);
      if (wsMatch) {
        const [, workspaceId, resource] = wsMatch;
        if (!UUID_RE.test(workspaceId)) return json({ error: 'bad_workspace_id' }, 400);
        const workspace = await store.ensureWorkspace(env.DB, workspaceId);
        if (!workspace) return json({ error: 'no_such_workspace' }, 404);

        if (resource === 'state' && method === 'GET') return handleState(env, workspaceId, url);
        if (resource === 'sessions' && method === 'POST') return handleSessions(request, env, workspaceId);
        if (resource === 'tasks' && method === 'PUT') return handleTasks(request, env, workspaceId);
        if (resource === 'settings' && method === 'PUT') return handleSettings(request, env, workspaceId);
        if (resource === 'analytics' && method === 'GET') return handleAnalytics(env, workspaceId, url);
      }

      if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);

      // Any other non-API path that Assets didn't already serve.
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error('[api]', method, pathname, err);
      return json({ error: 'server_error' }, 500);
    }
  },
};
