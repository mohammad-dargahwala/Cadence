'use strict';

/* Thin server-side wrapper. All aggregation logic lives in
 * public/analytics-core.js so the browser's offline computation and the
 * server's authoritative computation are literally the same code path. */

const { db } = require('./db');
const { computeAnalytics } = require('../public/analytics-core.js');

const selectFocus = db.prepare(`
  SELECT seconds, category, local_date AS localDate, mode, completed
    FROM sessions
   WHERE workspace_id = ? AND mode = 'focus' AND completed = 1
`);

function analytics(workspaceId, today, opts = {}) {
  const rows = selectFocus.all(workspaceId).map((r) => ({
    mode: r.mode,
    seconds: r.seconds,
    category: r.category,
    localDate: r.localDate,
    completed: !!r.completed,
  }));
  return computeAnalytics(rows, today, opts);
}

module.exports = { analytics };
