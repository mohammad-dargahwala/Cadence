# Cadence

Cadence is a Pomodoro timer with a task list and a record of your focus sessions. Pick a task, start a focus block, and check Analytics to see your focus time for the day.

[Use Cadence](https://cadence.mdargahwala.tech)

## The timer

The default cycle is 25 minutes of focus, then a 5-minute break. After four focus rounds, the break lasts 15 minutes. You can change all three durations in Settings, along with the theme, volume, alarm sound, and whether the next interval starts automatically.

Pin a task to show it on the timer. Tasks can be added, completed, or deleted. New accounts come with four sample tasks; they're just examples and can be removed.

**Reset** restarts the current interval. **Reset all** returns to round one. **Skip** moves to the next interval and records the time already spent. Resetting does not save that interval to your history.

Analytics count focus intervals with at least a minute recorded, including ones ended with Skip. Breaks are saved but left out of focus totals. The Analytics tab shows daily time, session counts, streaks, weekly totals, and a category breakdown.

## Themes and minimalist settings

The eight themes include Aurora (flowing light), Solstice (sunset dunes), Sakura (drifting petals), and Tidal (ocean contours). Their backgrounds are drawn locally on a canvas. Settings → Minimalist lets you turn backgrounds, movement, the timer wave, cursor effects, round/task details, and interface sounds on or off. System reduced-motion preferences are respected.

The original background scenes take visual cues from [James Turrell's light fields](https://web.guggenheim.org/exhibitions/turrell/) and [teamLab's Black Waves](https://www.teamlab.art/w/black_waves/); no artwork is copied or downloaded.

## Spotify

Settings → Spotify includes setup instructions and an exact redirect URI for a Spotify Developer app. Paste its public Client ID and authorize with Spotify. No client secret is needed. Choose a song and an active device in Spotify first; Cadence controls that device through the Web API.

The player can be Off, controls only (Hide), Minimalist, Full, or album cover only, with a separate song-name toggle. Playback resumes during a running focus interval and pauses on timer pause/reset, interval completion, breaks, Off, disconnect, and sign-out. A manual music pause lasts until the next focus block. Keep Cadence open and online for automation; closed or suspended browsers cannot reliably control another device.

Spotify playback control requires Premium. Development-mode apps also require a Premium app owner and an allowlisted listener; see [Spotify's quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes). Authorization uses [PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow). Tokens are scoped to the signed-in workspace in this browser tab's session storage, excluded from Cadence sync, and cleared on sign-out or disconnect.

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

`npm test` runs analytics, timer/appearance regressions, mocked Spotify playback checks, and local Worker API tests. Spotify checks use a fake clock and mocked transport, not a live Spotify account. The Python browser checks in `test/browser.test.py` need Playwright and a Chrome executable and are not part of that command.

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

