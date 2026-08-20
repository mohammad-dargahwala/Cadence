'use strict';

/* Thin server-side wrapper. All aggregation logic lives in
 * public/analytics-core.js so the browser's offline computation and the
 * Worker's authoritative computation are literally the same code path. */

const { computeAnalytics } = require('../public/analytics-core.js');

async function analytics(db, workspaceId, today, opts = {}) {
  const { results } = await db
    .prepare(
      `SELECT seconds, category, local_date AS localDate, mode, completed
         FROM sessions
        WHERE workspace_id = ? AND mode = 'focus' AND completed = 1`
    )
    .bind(workspaceId)
    .all();

  const rows = results.map((r) => ({
    mode: r.mode,
    seconds: r.seconds,
    category: r.category,
    localDate: r.localDate,
    completed: !!r.completed,
  }));
  return computeAnalytics(rows, today, opts);
}

module.exports = { analytics };
