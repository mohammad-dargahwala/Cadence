'use strict';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;

function cleanTimer(t) {
  if (!t || !UUID.test(t.id || '') || !UUID.test(t.changeId || '') ||
      !['focus', 'short', 'long'].includes(t.mode) ||
      !Number.isInteger(t.round) || !finite(t.round, 1, 4) ||
      typeof t.running !== 'boolean' || !finite(t.planned, 60, 10800) ||
      !finite(t.remaining, 0, t.planned) || !finite(t.deadline, 0, 1e15) ||
      !finite(t.startedAt, 0, 1e15) || !/^\d{4}-\d{2}-\d{2}$/.test(t.localDate || '') ||
      (t.running && !t.deadline)) return null;
  return {
    id: t.id, changeId: t.changeId, mode: t.mode, round: t.round,
    running: t.running, planned: t.planned, remaining: Math.round(t.remaining),
    deadline: t.running ? t.deadline : 0, startedAt: t.startedAt,
    localDate: t.localDate, taskId: t.taskId ? String(t.taskId).slice(0, 64) : null,
    category: String(t.category || 'UNSORTED').slice(0, 80),
  };
}

async function getTimer(db, workspaceId) {
  const row = await db.prepare('SELECT payload FROM timers WHERE workspace_id = ?').bind(workspaceId).first();
  return row ? JSON.parse(row.payload) : null;
}

// Both the state transition and its history entry commit in the same transaction.
// Replaying an accepted operation is safe, even if its HTTP response was lost.
async function putTimer(db, workspaceId, timer, baseChangeId, session) {
  const statements = [db.prepare(`
    INSERT INTO timers (workspace_id, change_id, payload)
    SELECT ?, ?, ? WHERE ? IS NULL
    ON CONFLICT(workspace_id) DO UPDATE SET change_id = ?, payload = ?
      WHERE timers.change_id = ? OR timers.change_id = ?
  `).bind(workspaceId, timer.changeId, JSON.stringify(timer), baseChangeId,
    timer.changeId, JSON.stringify(timer), baseChangeId, timer.changeId)];
  // UPDATE needs an existing row when baseChangeId is non-null.
  if (baseChangeId !== null) statements[0] = db.prepare(`
    UPDATE timers SET change_id = ?, payload = ?
    WHERE workspace_id = ? AND (change_id = ? OR change_id = ?)
  `).bind(timer.changeId, JSON.stringify(timer), workspaceId, baseChangeId, timer.changeId);
  if (session) statements.push(db.prepare(`
    INSERT INTO sessions (id, workspace_id, mode, seconds, planned, completed,
      task_id, category, started_at, ended_at, local_date, device_id)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    WHERE EXISTS (SELECT 1 FROM timers WHERE workspace_id = ? AND change_id = ?)
    ON CONFLICT(id) DO NOTHING
  `).bind(session.id, workspaceId, session.mode, Math.round(session.seconds),
    session.planned, session.completed ? 1 : 0, session.taskId || null,
    session.category || 'UNSORTED', session.startedAt, session.endedAt,
    session.localDate, workspaceId, timer.changeId));
  const results = await db.batch(statements);
  return { accepted: results[0].meta.changes > 0, timer: await getTimer(db, workspaceId) };
}

module.exports = { cleanTimer, getTimer, putTimer };
