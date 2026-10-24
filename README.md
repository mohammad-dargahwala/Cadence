# Cadence

Cadence is a Pomodoro timer with a task list and a record of your focus sessions. Pick a task, start a focus block, and check Analytics to see your focus time for the day.

[Use Cadence](https://cadence.mdargahwala.tech)

## The timer

The default cycle is 25 minutes of focus, then a 5-minute break. After four focus rounds, the break lasts 15 minutes. You can change all three durations in Settings, along with the theme, volume, alarm sound, and whether the next interval starts automatically.

Pin a task to show it on the timer. Tasks can be added, completed, or deleted. New accounts come with four sample tasks; they're just examples and can be removed.

**Reset** restarts the current interval. **Reset all** returns to round one. **Skip** moves to the next interval and records the time already spent. Resetting does not save that interval to your history.

Analytics count focus intervals with at least a minute recorded, including ones ended with Skip. Breaks are saved but left out of focus totals. The Analytics tab shows daily time, session counts, streaks, weekly totals, and a category breakdown.

## Accounts and saving

Choose a name and a 4–8 digit PIN when you register. The same login on another device brings back your tasks, settings, and saved sessions.

The countdown itself stays in the browser where you started it. Starting a timer on your phone won't start one on your laptop. A saved deadline lets the same browser recover the remaining time after a reload.

The page saves account data in localStorage before sending changes to a Cloudflare Worker and D1 database. It retries failed writes, shares updates between tabs, and checks for changes from other devices every minute. Duplicate session uploads are ignored by ID; competing task and settings edits are resolved by timestamps.

You can keep using an already loaded page during a connection failure. Signing in and syncing still need the network. There is no service worker, so loading the page from scratch offline is not guaranteed. Unsynced changes can be lost if you clear browser storage.

## Local setup

Install Node.js and npm compatible with [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/), then run:

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Open the URL printed by Wrangler, normally `http://localhost:8787`. This uses a local D1 database with its own accounts.

`npm test` runs the analytics and local Worker API tests. The Python browser checks in `test/browser.test.py` need Playwright and a Chrome executable and are not part of that command.

## Hosting a copy

The repository's `wrangler.toml` contains the existing site's domain and database ID. Replace those with your own before deploying.

Sign in with `npx wrangler login`, then create a database with `npx wrangler d1 create cadence`. Set its ID in the `DB` binding, keeping the database name `cadence` and the `migrations/` directory. Replace the custom domain in `[[routes]]`, or remove that block to use a Workers subdomain.

```sh
npm run db:migrate:remote
npm run deploy
```

The frontend is in `public/Pomodoro.dc.html`. `public/sync.js` handles saving, `public/analytics-core.js` calculates the statistics, and `src/` contains the API, D1 queries, and login code. React 18 is served locally; fonts come from Google Fonts.

## Current limitations

The PIN is hashed with salted SHA-256. After login, the workspace ID acts as the API credential: anyone who has it can read and change that workspace. There is no login rate limit, account recovery, or server-side revocation on logout. Avoid storing sensitive information in this account model.

The state API returns up to 5,000 sessions without pagination. Server analytics query focus history separately, so browser totals can differ when older sessions are missing from its cache.

## License

[MIT](LICENSE)

