-- Cadence — D1 schema. Mirrors the shape the old SQLite file used, adapted
-- for D1's async prepared-statement API (see src/db.js).

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

-- A login is just a name + PIN mapped to a workspace. No email, no session
-- tokens: the workspace id (already a bearer capability) is handed back on a
-- successful login and the client adopts it exactly like the old share-link
-- flow did. name_lower enforces case-insensitive uniqueness while name keeps
-- the casing the person actually typed for display.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  name_lower    TEXT NOT NULL UNIQUE,
  pin_hash      TEXT NOT NULL,              -- 'saltHex:hashHex' (SHA-256)
  workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at    INTEGER NOT NULL
);
