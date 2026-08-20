# Cadence

A Pomodoro timer built from a Claude Design mockup. The interface is exactly as
designed; everything behind it is real — sessions are recorded to a database and
the analytics follow you across reloads, tabs, browsers and devices.

```bash
npm install
npm start          # http://localhost:3000
npm test
```

## What changed from the mockup

The mockup was a faithful but self-contained prototype: the analytics numbers
were literals in the source, and tasks and settings lived in React state, so a
refresh erased everything.

**No markup, styling, layout, copy or interaction was altered.** Four hardcoded
data literals in the analytics panel became bindings, because a number that
cannot change is not really a number:

| Was | Now |
| --- | --- |
| `17.4H TOTAL` | `{{ weekTotal }}` |
| `conic-gradient(… 0 42%, … 42% 68% …)` | `{{ donut }}` |
| `42%` | `{{ topCatPct }}` |
| `DEEP WORK` | `{{ topCatName }}` |

Everything else was already bound to `renderVals()`; that function now returns
the same keys in the same shapes, computed from real data instead of constants.
A first visit still seeds the same four sample tasks, so the app opens looking
exactly like the approved design.

## How persistence works

Three layers, each degrading into the one below it:

| Layer | Survives | Mechanism |
| --- | --- | --- |
| `localStorage` | reload, offline | write-through cache |
| `BroadcastChannel` | other tabs | live fan-out, `storage` event fallback |
| HTTP + SQLite | cache clears, other devices | append-only sync |

Writes are local-first — the UI never waits on the network. Mutations land in
`localStorage`, fan out to sibling tabs, and queue in an outbox that drains to
the server with exponential backoff. Pull the plug and the app keeps working;
reconnect and it catches up.

### Why sessions are an event log

Each finished interval is an immutable row keyed by a client-generated UUID,
and every total is derived from those rows at read time. Two consequences worth
the design:

- **Retries are free.** Replaying a batch is a no-op, so a flaky connection can
  never inflate your focus time.
- **Merging devices is a set union.** A phone that was offline all afternoon
  just adds its rows; nothing has to be reconciled.

Tasks and settings are small documents a human edits one at a time, so they use
per-record last-write-wins on `updatedAt`. Deletes are tombstones — a delete has
to replicate, or it comes back on the next sync.

### Timezones

Every session stores the local calendar date of the device that recorded it, and
the client sends its own "today" when reading. Day boundaries follow the user,
not the server, so a session logged at 11pm never slides into tomorrow.

### The running timer

The timer is pinned to a wall-clock deadline rather than a count of ticks. A
throttled background tab, a sleeping laptop, or a full page reload all resume at
the correct remaining time, and an interval that finished while the tab was
closed is settled on the next open.

## Accounts

A name and passphrase map to a workspace. Sign in on any device with the same
credentials to reach the same workspace — no share links, no UUID in the URL.
The passphrase is never stored in the clear; each account gets a random salt
and is hashed with scrypt (built into Node.js) before it ever touches the
database.

The workspace id remains the API's bearer credential (you can still point
`CadenceStore` at any id if you're running your own backend), but the account
is what gates access to it — a lightweight gate appropriate for personal use
or a small team. For anything at scale, put a real auth provider or OAuth
layer in front of the API.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | liveness |
| `POST` | `/api/auth/register` | create an account and a workspace for it |
| `POST` | `/api/auth/login` | sign in and receive a workspace id |
| `POST` | `/api/workspaces` | provision a workspace (legacy; accounts are preferred) |
| `GET` | `/api/workspaces/:id/state` | pull sessions, tasks, settings |
| `POST` | `/api/workspaces/:id/sessions` | append intervals (idempotent) |
| `PUT` | `/api/workspaces/:id/tasks` | upsert tasks (LWW) |
| `PUT` | `/api/workspaces/:id/settings` | upsert settings (LWW) |
| `GET` | `/api/workspaces/:id/analytics?today=YYYY-MM-DD` | derived metrics |

Malformed sessions are dropped individually rather than failing the batch; the
response reports `written` and `rejected` counts.

## What counts as focus

Only `focus` intervals reach the analytics — breaks are logged but excluded. An
interval counts once at least a minute of work has happened, so cutting a block
short still records the time you actually put in. `planned` keeps the intended
length alongside it, so full and partial blocks stay distinguishable.

Streaks count backwards from today, and a day you haven't started yet doesn't
break one.

## Layout

```
server/
  index.js           Express app, routes, validation, rate limit
  db.js              SQLite schema and queries
  analytics.js       thin wrapper over the shared core
public/
  Pomodoro.dc.html   the page — design untouched, logic rewired
  sync.js            local cache, outbox, cross-tab and cross-device sync
  analytics-core.js  aggregation, shared verbatim with the server
  vendor-map.js      points the runtime at locally hosted React
  support.js         Claude Design runtime (unmodified)
  vendor/            React 18.3.1 UMD builds
test/
  analytics.test.js  aggregation edge cases
  api.test.js        end-to-end HTTP, idempotency, workspace isolation
  browser.test.py    headless render, reload, offline, cross-device
```

`analytics-core.js` is loaded by both the browser and the server, so an offline
tab and the database can never disagree about what a number means.

React is served from `public/vendor` rather than unpkg, so the app has no
third-party runtime dependency and works behind a firewall.

## Deploying

The database is a single SQLite file under `data/`, created on first run. Set
`DATA_DIR` to move it and `PORT` to change the port. On a platform with an
ephemeral filesystem, mount a volume at `data/` or the history resets on
redeploy.

The bundled rate limit is in-process and per-instance — a backstop against a
runaway tab, not a security control. Put a real limiter and TLS in front of
anything public.

## License

MIT
