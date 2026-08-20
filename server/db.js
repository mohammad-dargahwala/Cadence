'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'cadence.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS workspaces (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);

-- Immutable append-only event log. One row per completed (or skipped) interval.
-- Analytics are always derived from this table, never stored pre-aggregated,
-- so a late-arriving event from another device can never corrupt a total.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,          -- client-generated UUID => idempotent replay
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('focus','short','long')),
  seconds       INTEGER NOT NULL CHECK (seconds >= 0),
  planned       INTEGER NOT NULL DEFAULT 0,
  completed     INTEGER NOT NULL DEFAULT 1, -- 0 = skipped early
  task_id       TEXT,
  category      TEXT,
  started_at    INTEGER NOT NULL,           -- epoch ms, UTC
  ended_at      INTEGER NOT NULL,
  local_date    TEXT NOT NULL,              -- 'YYYY-MM-DD' in the device's zone
  device_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_ws_date ON sessions(workspace_id, local_date);
CREATE INDEX IF NOT EXISTS idx_sessions_ws_end  ON sessions(workspace_id, ended_at);

-- Last-write-wins documents. Tasks and settings are small and edited by a
-- human one at a time, so per-row LWW on updated_at is sufficient; only the
-- session log needs true append-only merge semantics.
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT NOT NULL,
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'UNSORTED',
  done          INTEGER NOT NULL DEFAULT 0,
  pinned        INTEGER NOT NULL DEFAULT 0,
  deleted       INTEGER NOT NULL DEFAULT 0, -- tombstone: deletes must replicate
  sort_index    INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS settings (
  workspace_id  TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  payload       TEXT NOT NULL,              -- JSON blob
  updated_at    INTEGER NOT NULL
);

-- A login is just a name + passphrase mapped to a workspace. No email, no
-- session tokens: the workspace id (already a bearer capability) is handed
-- back on a successful login and the client adopts it exactly like the old
-- share-link flow did. name_lower enforces case-insensitive uniqueness while
-- name keeps the casing the person actually typed for display.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_lower    TEXT NOT NULL UNIQUE,
  passphrase    TEXT NOT NULL,              -- 'saltHex:hashHex' (scrypt)
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL
);
`);

const newId = () => crypto.randomUUID();

/* ------------------------------------------------------------------ *
 * workspaces
 * ------------------------------------------------------------------ */

const stmts = {
  insertWorkspace: db.prepare(
    'INSERT INTO workspaces (id, created_at, seen_at) VALUES (?, ?, ?)'
  ),
  getWorkspace: db.prepare('SELECT * FROM workspaces WHERE id = ?'),
  touchWorkspace: db.prepare('UPDATE workspaces SET seen_at = ? WHERE id = ?'),

  insertSession: db.prepare(`
    INSERT INTO sessions
      (id, workspace_id, mode, seconds, planned, completed, task_id,
       category, started_at, ended_at, local_date, device_id)
    VALUES
      (@id, @workspace_id, @mode, @seconds, @planned, @completed, @task_id,
       @category, @started_at, @ended_at, @local_date, @device_id)
    ON CONFLICT(id) DO NOTHING
  `),
  sessionsSince: db.prepare(
    'SELECT * FROM sessions WHERE workspace_id = ? AND ended_at > ? ORDER BY ended_at ASC LIMIT 5000'
  ),

  upsertTask: db.prepare(`
    INSERT INTO tasks
      (id, workspace_id, name, category, done, pinned, deleted, sort_index, updated_at)
    VALUES
      (@id, @workspace_id, @name, @category, @done, @pinned, @deleted, @sort_index, @updated_at)
    ON CONFLICT(workspace_id, id) DO UPDATE SET
      name       = excluded.name,
      category   = excluded.category,
      done       = excluded.done,
      pinned     = excluded.pinned,
      deleted    = excluded.deleted,
      sort_index = excluded.sort_index,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > tasks.updated_at
  `),
  tasksAll: db.prepare(
    'SELECT * FROM tasks WHERE workspace_id = ? ORDER BY sort_index ASC, updated_at ASC'
  ),

  getSettings: db.prepare('SELECT * FROM settings WHERE workspace_id = ?'),
  upsertSettings: db.prepare(`
    INSERT INTO settings (workspace_id, payload, updated_at)
    VALUES (@workspace_id, @payload, @updated_at)
    ON CONFLICT(workspace_id) DO UPDATE SET
      payload    = excluded.payload,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > settings.updated_at
  `),

  insertUser: db.prepare(`
    INSERT INTO users (id, name, name_lower, passphrase, workspace_id, created_at)
    VALUES (@id, @name, @name_lower, @passphrase, @workspace_id, @created_at)
  `),
  getUserByNameLower: db.prepare('SELECT * FROM users WHERE name_lower = ?'),
};

function createWorkspace() {
  const id = newId();
  const now = Date.now();
  stmts.insertWorkspace.run(id, now, now);
  return id;
}

/** Workspaces are bearer-capability IDs — holding the UUID is the credential. */
function ensureWorkspace(id) {
  const row = stmts.getWorkspace.get(id);
  if (!row) return null;
  stmts.touchWorkspace.run(Date.now(), id);
  return row;
}

/* ------------------------------------------------------------------ *
 * sessions
 * ------------------------------------------------------------------ */

const insertSessions = db.transaction((workspaceId, rows) => {
  let written = 0;
  for (const r of rows) {
    const res = stmts.insertSession.run({
      id: r.id,
      workspace_id: workspaceId,
      mode: r.mode,
      seconds: Math.round(r.seconds),
      planned: Math.round(r.planned || 0),
      completed: r.completed === false ? 0 : 1,
      task_id: r.taskId || null,
      category: r.category || null,
      started_at: r.startedAt,
      ended_at: r.endedAt,
      local_date: r.localDate,
      device_id: r.deviceId || null,
    });
    written += res.changes;
  }
  return written;
});

const getSessions = (workspaceId, since = 0) =>
  stmts.sessionsSince.all(workspaceId, since).map(rowToSession);

const rowToSession = (r) => ({
  id: r.id,
  mode: r.mode,
  seconds: r.seconds,
  planned: r.planned,
  completed: !!r.completed,
  taskId: r.task_id,
  category: r.category,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  localDate: r.local_date,
});

/* ------------------------------------------------------------------ *
 * tasks
 * ------------------------------------------------------------------ */

const putTasks = db.transaction((workspaceId, rows) => {
  for (const t of rows) {
    stmts.upsertTask.run({
      id: String(t.id),
      workspace_id: workspaceId,
      name: String(t.name || '').slice(0, 500),
      category: String(t.category || 'UNSORTED').slice(0, 80),
      done: t.done ? 1 : 0,
      pinned: t.pinned ? 1 : 0,
      deleted: t.deleted ? 1 : 0,
      sort_index: Number(t.sortIndex) || 0,
      updated_at: Number(t.updatedAt) || Date.now(),
    });
  }
});

const getTasks = (workspaceId) =>
  stmts.tasksAll.all(workspaceId).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    done: !!r.done,
    pinned: !!r.pinned,
    deleted: !!r.deleted,
    sortIndex: r.sort_index,
    updatedAt: r.updated_at,
  }));

/* ------------------------------------------------------------------ *
 * settings
 * ------------------------------------------------------------------ */

function putSettings(workspaceId, payload, updatedAt) {
  stmts.upsertSettings.run({
    workspace_id: workspaceId,
    payload: JSON.stringify(payload),
    updated_at: Number(updatedAt) || Date.now(),
  });
}

function getSettings(workspaceId) {
  const row = stmts.getSettings.get(workspaceId);
  if (!row) return null;
  try {
    return { payload: JSON.parse(row.payload), updatedAt: row.updated_at };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * users
 * ------------------------------------------------------------------ */

/** `passphraseHash` is opaque here — server/auth.js owns hashing/verifying. */
function createUser(name, passphraseHash, workspaceId) {
  const id = newId();
  const now = Date.now();
  stmts.insertUser.run({
    id,
    name,
    name_lower: name.toLowerCase(),
    passphrase: passphraseHash,
    workspace_id: workspaceId,
    created_at: now,
  });
  return { id, name, workspaceId, createdAt: now };
}

function findUserByName(name) {
  const row = stmts.getUserByNameLower.get(String(name).toLowerCase());
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    passphrase: row.passphrase,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
  };
}

module.exports = {
  db,
  newId,
  createWorkspace,
  ensureWorkspace,
  insertSessions,
  getSessions,
  putTasks,
  getTasks,
  putSettings,
  getSettings,
  createUser,
  findUserByName,
};
