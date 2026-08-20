# Cadence

A Pomodoro timer built from a Claude Design mockup. The interface is exactly as
designed; everything behind it is real — sessions are recorded to a database and
the analytics follow you across reloads, tabs, browsers and devices.

Runs as a Cloudflare Worker backed by D1, so history survives redeploys instead
of living on one instance's disk.

```bash
npm install
npm run dev         # http://localhost:8787, via `wrangler dev`
npm test
npm run deploy      # publishes the Worker + static site
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
| HTTP + D1 | cache clears, other devices, redeploys | append-only sync |

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

A name and PIN map to a workspace. Sign in on any device with the same name
and PIN to reach the same workspace — no share links, no UUID in the URL, no
email. The PIN isn't stored in the clear (salted SHA-256, Web Crypto), but a
4–8 digit PIN is short by design — this is light hygiene, not a real security
boundary. It's deliberately minimal: no rate limiting, no lockouts, no
password-strength rules. For anything beyond personal or small-group use, put
a real auth provider in front of the API.

The workspace id remains the API's bearer credential (you can still point
`CadenceStore` at any id if you're running your own backend); the account is
just what gates access to it.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | liveness |
| `POST` | `/api/auth/register` | create an account (`name`, `pin`) and a workspace for it |
| `POST` | `/api/auth/login` | sign in with `name` + `pin`, receive a workspace id |
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
src/
  worker.js          Worker entrypoint: routes, validation
  db.js              D1 schema queries (async)
  analytics.js        thin wrapper over the shared core
  auth.js            name + PIN hashing (Web Crypto)
migrations/
  0001_init.sql       D1 schema
public/
  Pomodoro.dc.html   the page — design untouched, logic rewired
  sync.js            local cache, outbox, cross-tab and cross-device sync
  analytics-core.js  aggregation, shared verbatim with the Worker
  vendor-map.js      points the runtime at locally hosted React
  support.js         Claude Design runtime (unmodified)
  vendor/            React 18.3.1 UMD builds
test/
  analytics.test.js  aggregation edge cases
  api.test.js        end-to-end HTTP against a local Worker + D1, idempotency, workspace isolation
  browser.test.py    headless render, reload, offline, cross-device
wrangler.toml         Worker + assets + D1 binding config
```

`analytics-core.js` is loaded by both the browser and the Worker, so an offline
tab and the database can never disagree about what a number means.

React is served from `public/vendor` rather than unpkg, so the app has no
third-party runtime dependency and works behind a firewall.

## Deploying

Everything lives on Cloudflare: the Worker serves both the static site
(`public/`, via the Workers Assets binding) and the `/api/*` routes, backed by
a D1 database that survives redeploys.

```bash
npx wrangler login                        # once, interactively
npm run db:migrate:remote                 # apply migrations/ to the live D1 database
npm run deploy                            # wrangler deploy
```

`wrangler.toml` pins the D1 database by id — `d1_databases[0].database_id` —
so a fresh clone needs its own `wrangler d1 database create cadence` and an
updated id before its first deploy. To attach a custom domain instead of the
`workers.dev` subdomain, add a `[[routes]]` block with `custom_domain = true`
for the zone you want (see [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)).

There's no in-process rate limit here — Workers isolates don't share memory
across instances, so that kind of counter doesn't work reliably in this model.
Cloudflare's platform-level protections sit in front instead.

## License

MIT
