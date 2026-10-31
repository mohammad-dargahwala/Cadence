-- One timer per account. A change token prevents stale clients from rewinding it.
CREATE TABLE IF NOT EXISTS timers (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  change_id TEXT NOT NULL,
  payload TEXT NOT NULL
);
