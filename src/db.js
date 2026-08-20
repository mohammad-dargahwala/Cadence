'use strict';

/* D1 data layer. Same shape as the old better-sqlite3 module, adapted to
 * D1's async prepared-statement API: every call here awaits a round trip to
 * the database, and multi-row writes go through db.batch() (D1's atomic,
 * sequential-commit equivalent of a better-sqlite3 transaction). */

const newId = () => crypto.randomUUID();

/* ------------------------------------------------------------------ *
 * workspaces
 * ------------------------------------------------------------------ */

async function createWorkspace(db) {
  const id = newId();
  const now = Date.now();
  await db.prepare('INSERT INTO workspaces (id, created_at, seen_at) VALUES (?, ?, ?)').bind(id, now, now).run();
  return id;
}

/** Workspaces are bearer-capability IDs — holding the UUID is the credential. */
async function ensureWorkspace(db, id) {
  const row = await db.prepare('SELECT * FROM workspaces WHERE id = ?').bind(id).first();
  if (!row) return null;
  await db.prepare('UPDATE workspaces SET seen_at = ? WHERE id = ?').bind(Date.now(), id).run();
  return row;
}

/* ------------------------------------------------------------------ *
 * sessions
 * ------------------------------------------------------------------ */

const INSERT_SESSION = `
  INSERT INTO sessions
    (id, workspace_id, mode, seconds, planned, completed, task_id,
     category, started_at, ended_at, local_date, device_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`;

async function insertSessions(db, workspaceId, rows) {
  if (!rows.length) return 0;
  const stmt = db.prepare(INSERT_SESSION);
  const batch = rows.map((r) =>
    stmt.bind(
      r.id,
      workspaceId,
      r.mode,
      Math.round(r.seconds),
      Math.round(r.planned || 0),
      r.completed === false ? 0 : 1,
      r.taskId || null,
      r.category || null,
      r.startedAt,
      r.endedAt,
      r.localDate,
      r.deviceId || null
    )
  );
  const results = await db.batch(batch);
  return results.reduce((n, res) => n + (res.meta ? res.meta.changes : 0), 0);
}

async function getSessions(db, workspaceId, since = 0) {
  const { results } = await db
    .prepare('SELECT * FROM sessions WHERE workspace_id = ? AND ended_at > ? ORDER BY ended_at ASC LIMIT 5000')
    .bind(workspaceId, since)
    .all();
  return results.map(rowToSession);
}

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

const UPSERT_TASK = `
  INSERT INTO tasks
    (id, workspace_id, name, category, done, pinned, deleted, sort_index, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, id) DO UPDATE SET
    name       = excluded.name,
    category   = excluded.category,
    done       = excluded.done,
    pinned     = excluded.pinned,
    deleted    = excluded.deleted,
    sort_index = excluded.sort_index,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at > tasks.updated_at
`;

async function putTasks(db, workspaceId, rows) {
  if (!rows.length) return;
  const stmt = db.prepare(UPSERT_TASK);
  const batch = rows.map((t) =>
    stmt.bind(
      String(t.id),
      workspaceId,
      String(t.name || '').slice(0, 500),
      String(t.category || 'UNSORTED').slice(0, 80),
      t.done ? 1 : 0,
      t.pinned ? 1 : 0,
      t.deleted ? 1 : 0,
      Number(t.sortIndex) || 0,
      Number(t.updatedAt) || Date.now()
    )
  );
  await db.batch(batch);
}

async function getTasks(db, workspaceId) {
  const { results } = await db
    .prepare('SELECT * FROM tasks WHERE workspace_id = ? ORDER BY sort_index ASC, updated_at ASC')
    .bind(workspaceId)
    .all();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    done: !!r.done,
    pinned: !!r.pinned,
    deleted: !!r.deleted,
    sortIndex: r.sort_index,
    updatedAt: r.updated_at,
  }));
}

/* ------------------------------------------------------------------ *
 * settings
 * ------------------------------------------------------------------ */

async function putSettings(db, workspaceId, payload, updatedAt) {
  await db
    .prepare(
      `INSERT INTO settings (workspace_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         payload    = excluded.payload,
         updated_at = excluded.updated_at
       WHERE excluded.updated_at > settings.updated_at`
    )
    .bind(workspaceId, JSON.stringify(payload), Number(updatedAt) || Date.now())
    .run();
}

async function getSettings(db, workspaceId) {
  const row = await db.prepare('SELECT * FROM settings WHERE workspace_id = ?').bind(workspaceId).first();
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

/** `pinHash` is opaque here — src/auth.js owns hashing/verifying. */
async function createUser(db, name, pinHash, workspaceId) {
  const id = newId();
  const now = Date.now();
  await db
    .prepare('INSERT INTO users (id, name, name_lower, pin_hash, workspace_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, name, name.toLowerCase(), pinHash, workspaceId, now)
    .run();
  return { id, name, workspaceId, createdAt: now };
}

async function findUserByName(db, name) {
  const row = await db.prepare('SELECT * FROM users WHERE name_lower = ?').bind(String(name).toLowerCase()).first();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    pinHash: row.pin_hash,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
  };
}

module.exports = {
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
