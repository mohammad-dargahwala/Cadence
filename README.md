# Cadence

A Pomodoro timer with tasks, focus history, and a name-and-PIN login.

[Open Cadence](https://cadence.mdargahwala.tech)

## Using it

Create an account with a name and a 4–8 digit PIN. Sign in with the same details on another device to load your saved tasks, settings, and session history. New accounts start with four sample tasks that you can remove.

The timer starts with 25-minute focus blocks, 5-minute short breaks, and a 15-minute long break after four focus rounds. You can change those durations in Settings.

- Add tasks, mark them done, or pin one as the current focus target.
- Pause, reset the current interval, skip ahead, or use **Reset all** to return to round one.
- Check daily focus time, session counts, streaks, weekly totals, and time by task category.
- Choose a theme, adjust the volume, or select Chime, Classical, Siren, or None for the completion alarm.

An interval is logged when it finishes or is skipped. Focus intervals with at least 60 seconds recorded count toward analytics; breaks do not. Resetting an interval does not log it.

## What gets saved

The browser keeps a local copy of account data and queues changes for the Worker to save in Cloudflare D1. Tabs exchange updates through `BroadcastChannel`, with a storage-event fallback. Other devices pick up changes through HTTP sync, including a periodic sync every minute.

Session records use unique IDs so retrying the same upload does not add the same record twice. Task edits and settings use timestamps to resolve competing changes.

The running countdown is saved separately in the current browser. It uses a deadline to recover the remaining time after a reload. **The active countdown does not sync between devices.**

An already loaded page can keep working with cached account data during a connection failure and retry pending writes later. Registration, login, and syncing need a connection. There is no service worker for guaranteed offline page loading. Clearing browser storage before pending changes sync can lose those changes.

## Run locally

Use Node.js and npm supported by the installed version of [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/).

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Open the local URL Wrangler prints, normally `http://localhost:8787`. Local development uses a separate D1 database; create a test account there.

```sh
npm test
```

This runs the analytics tests and API tests. The API tests start a local Worker and apply the local database migrations. The Python browser checks in `test/browser.test.py` are separate from `npm test` and require Playwright and a configured Chrome executable.

## Deploy your own copy

The checked-in `wrangler.toml` points to this project's database and custom domain. For a separate installation:

1. Sign in to your Cloudflare account with `npx wrangler login`.
2. Create a D1 database with `npx wrangler d1 create cadence`, or choose an existing one.
3. Set the `DB` binding's `database_id` and `database_name` in `wrangler.toml` to your database. Keep `migrations_dir = "migrations"`. The npm migration scripts use the name `cadence`; update them if you choose another name.
4. Replace the custom domain in `[[routes]]` with yours, or remove that block to use a Workers subdomain.
5. Apply the remote schema and deploy:

```sh
npm run db:migrate:remote
npm run deploy
```

The Worker serves the frontend from `public/` and handles the API. D1 holds accounts, workspaces, sessions, tasks, and settings.

## Code

| Path | Purpose |
| --- | --- |
| `public/Pomodoro.dc.html` | Timer, tasks, analytics, settings, and login UI |
| `public/sync.js` | Browser cache, pending writes, and synchronization |
| `public/analytics-core.js` | Analytics calculations shared with the Worker |
| `src/worker.js` | HTTP routes and input validation |
| `src/db.js` | D1 queries |
| `src/auth.js` | Name and PIN validation and hashing |
| `migrations/` | Database schema |
| `test/` | Analytics, API, and browser checks |

The frontend uses locally hosted React 18 builds and the included design runtime. Fonts load from Google Fonts.

## Access and limits

PINs are stored as salted SHA-256 hashes. After login, the browser receives a workspace ID; possession of that ID grants read and write access to that workspace's API. The code has no login rate limiting, account recovery, or server-side logout that revokes a workspace ID. This account model is intended for a personal project, not sensitive data.

The state API currently returns at most 5,000 session records without pagination. Server analytics query focus history separately, so an older history missing from the browser's cache can make its local totals differ from the server's. Reading the full event history needs pagination.

## License

[MIT](LICENSE)

