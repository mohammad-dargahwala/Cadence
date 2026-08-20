'use strict';

const path = require('path');
const express = require('express');
const cors = require('cors');

const store = require('./db');
const { analytics } = require('./analytics');
const auth = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '512kb' }));

/* ---------------------------------------------------------------- *
 * Minimal in-process rate limit. Enough to stop a runaway sync loop
 * from a buggy tab; put a real limiter in front for public hosting.
 * ---------------------------------------------------------------- */
const hits = new Map();
const WINDOW = 60000;
const MAX = 240;

app.use('/api', (req, res, next) => {
  const key = req.ip || 'anon';
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { n: 1, reset: now + WINDOW });
    return next();
  }
  if (++rec.n > MAX) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, WINDOW).unref();

/* Tighter limit on login/register specifically — the general /api limit is
 * sized for a syncing tab, not for slowing down passphrase guessing. */
const authHits = new Map();
const AUTH_WINDOW = 10 * 60000;
const AUTH_MAX = 20;

app.use('/api/auth', (req, res, next) => {
  const key = req.ip || 'anon';
  const now = Date.now();
  const rec = authHits.get(key);
  if (!rec || now > rec.reset) {
    authHits.set(key, { n: 1, reset: now + AUTH_WINDOW });
    return next();
  }
  if (++rec.n > AUTH_MAX) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  next();
});

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authHits) if (now > v.reset) authHits.delete(k);
}, AUTH_WINDOW).unref();

/* ---------------------------------------------------------------- *
 * helpers
 * ---------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolves :id to a live workspace or 404s. The UUID is the bearer
 *  credential — unguessable, and never placed in a URL the browser
 *  sends anywhere but this API. */
function withWorkspace(req, res, next) {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'bad_workspace_id' });
  if (!store.ensureWorkspace(id)) return res.status(404).json({ error: 'no_such_workspace' });
  req.workspaceId = id;
  next();
}

const asyncSafe = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    console.error('[api]', req.method, req.path, err);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  }
};

/* ---------------------------------------------------------------- *
 * routes
 * ---------------------------------------------------------------- */

app.get('/api/health', (req, res) => res.json({ ok: true, at: Date.now() }));

/* ---------------------------------------------------------------- *
 * auth — name + passphrase, mapped to a workspace. No email, no
 * sessions to manage: a successful login just hands back the workspace
 * id, which the client adopts the same way it always adopted one.
 * ---------------------------------------------------------------- */

app.post(
  '/api/auth/register',
  asyncSafe((req, res) => {
    const name = auth.validateName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'bad_name' });
    const pass = auth.validatePassphrase(req.body?.passphrase);
    if (!pass) return res.status(400).json({ error: 'bad_passphrase' });

    if (store.findUserByName(name)) return res.status(409).json({ error: 'name_taken' });

    const workspaceId = store.createWorkspace();
    const user = store.createUser(name, auth.hashPassphrase(pass), workspaceId);
    res.status(201).json({ name: user.name, workspaceId: user.workspaceId });
  })
);

app.post(
  '/api/auth/login',
  asyncSafe((req, res) => {
    const name = auth.validateName(req.body?.name);
    if (!name) return res.status(400).json({ error: 'bad_name' });
    const pass = auth.validatePassphrase(req.body?.passphrase);
    if (!pass) return res.status(400).json({ error: 'bad_passphrase' });

    const user = store.findUserByName(name);
    if (!user) return res.status(404).json({ error: 'no_such_user' });
    if (!auth.verifyPassphrase(pass, user.passphrase)) {
      return res.status(401).json({ error: 'bad_credentials' });
    }
    res.json({ name: user.name, workspaceId: user.workspaceId });
  })
);

app.post(
  '/api/workspaces',
  asyncSafe((req, res) => {
    const id = store.createWorkspace();
    res.status(201).json({ id });
  })
);

/** Full pull. `since` lets a returning tab fetch only new session events. */
app.get(
  '/api/workspaces/:id/state',
  withWorkspace,
  asyncSafe((req, res) => {
    const since = Number(req.query.since) || 0;
    const settings = store.getSettings(req.workspaceId);
    res.json({
      workspaceId: req.workspaceId,
      serverTime: Date.now(),
      sessions: store.getSessions(req.workspaceId, since),
      tasks: store.getTasks(req.workspaceId),
      settings: settings ? settings.payload : null,
      settingsUpdatedAt: settings ? settings.updatedAt : 0,
    });
  })
);

/** Append-only session push. Idempotent: replaying the same client-generated
 *  ids is a no-op, so an unreliable network can retry without double-counting. */
app.post(
  '/api/workspaces/:id/sessions',
  withWorkspace,
  asyncSafe((req, res) => {
    const raw = Array.isArray(req.body?.sessions) ? req.body.sessions : [];
    if (raw.length > 500) return res.status(413).json({ error: 'too_many_sessions' });

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

    const written = store.insertSessions(req.workspaceId, clean);
    res.json({ accepted: clean.length, written, rejected: raw.length - clean.length });
  })
);

app.put(
  '/api/workspaces/:id/tasks',
  withWorkspace,
  asyncSafe((req, res) => {
    const raw = Array.isArray(req.body?.tasks) ? req.body.tasks : [];
    if (raw.length > 1000) return res.status(413).json({ error: 'too_many_tasks' });
    store.putTasks(
      req.workspaceId,
      raw.filter((t) => t && t.id != null)
    );
    res.json({ tasks: store.getTasks(req.workspaceId) });
  })
);

app.put(
  '/api/workspaces/:id/settings',
  withWorkspace,
  asyncSafe((req, res) => {
    const payload = req.body?.settings;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'bad_settings' });
    }
    store.putSettings(req.workspaceId, payload, req.body.updatedAt);
    const saved = store.getSettings(req.workspaceId);
    res.json({ settings: saved?.payload || null, updatedAt: saved?.updatedAt || 0 });
  })
);

app.get(
  '/api/workspaces/:id/analytics',
  withWorkspace,
  asyncSafe((req, res) => {
    const today = String(req.query.today || '');
    if (!DATE_RE.test(today)) return res.status(400).json({ error: 'bad_today' });
    res.json(analytics(req.workspaceId, today, { goal: req.query.goal }));
  })
);

/* ---------------------------------------------------------------- *
 * static site
 * ---------------------------------------------------------------- */

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// The design ships no icon; answer explicitly so the browser's automatic
// request doesn't fall through to the JSON 404 handler and litter the console.
app.get('/favicon.ico', (req, res) => res.status(204).end());

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'Pomodoro.dc.html')));

app.use((req, res) => res.status(404).json({ error: 'not_found' }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Cadence running at http://localhost:${PORT}`);
  });
}

module.exports = app;
