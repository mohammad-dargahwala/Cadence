# Cadence

Cadence is a Pomodoro timer with a task list and a record of your focus sessions. Pick a task, start a focus block, and check Analytics to see your focus time for the day.

[Use Cadence](https://cadence.mdargahwala.tech)

## The timer

The default cycle is 25 minutes of focus, then a 5-minute break. After four focus rounds, the break lasts 15 minutes. You can change all three durations in Settings, along with the theme, volume, alarm sound, and whether the next interval starts automatically.

Pin a task to show it on the timer. Tasks can be added, completed, or deleted. New accounts come with four sample tasks; they're just examples and can be removed.

**Reset** restarts the current interval. **Reset all** returns to round one. **Skip** moves to the next interval and records the time already spent. Resetting does not save that interval to your history.

Analytics count focus intervals with at least a minute recorded, including ones ended with Skip. Breaks are saved but left out of focus totals. The Analytics tab shows daily time, session counts, streaks, weekly totals, and a category breakdown.

## Themes and minimalist settings

Nine named worlds, each with its own moving artwork and countdown dial:

- **Nebula Bloom** — evolving violet and turquoise gas clouds and a luminous starlit lens.
- **Event Horizon** — an incandescent accretion disk, a bent halo and a dark timekeeping core.
- **Painted Valley** — oil-brushed mountains, soft Gaussian mist and flowing water, with a warm landscape medallion.
- **Abyssal Ballet** — translucent jellyfish with independently moving tentacles, and a glowing bell-shaped dial.
- **Lantern Drift** — rising paper lanterns over a twilight lake and a warm ribbed paper timer.
- **Cherry Blossom** — wind-carried petals and a blossom lens.
- **Rivers of Color** — evolving marbled pigment and a morphing paint droplet.
- **Stardust** — integrated particle trails and precessing orbital rings.
- **Firefly Grove** — layered woodland and a glass fern terrarium.

The old Graphite, Ember, Mist and Clay selections are retired. Saved Graphite maps to Nebula Bloom, Ember to Lantern Drift, and Mist/Clay to Painted Valley. Existing animated selections stay intact.

The scenes use local canvas artwork, evolving GPU gas/pigment fields and canvas fallbacks. Painted Valley layers moving mist, light and water over a bundled oil painting created with the built-in image generation tool; its prompt is in `public/art/README.md`. Minimalist settings control backgrounds, motion, timer artwork, cursor effects, details and sounds. Flow mode runs while the timer is idle. Choose Gentle, Fluid or Expressive pace, pause it explicitly, or enable Follow system reduced motion. Settings links to a music-free gallery at `/living-themes.html`, with a scene-only view and countdown scrubber. Only visible gallery scenes animate.

Visual references include [NASA's black hole accretion disk visualization](https://svs.gsfc.nasa.gov/13326/), [Webb's Cosmic Cliffs](https://esawebb.org/images/weic2205a/), and [Cézanne's mountain/valley oil painting at the Met](https://www.metmuseum.org/art/collection/search/435877). These inform the original generated compositions; no reference images or videos are embedded. The black hole is an artistic interpretation. Earlier scenes take inspiration from [Refik Anadol](https://refikanadol.com/works/unsupervised/) and [teamLab](https://www.teamlab.art/).

## Alarm sounds

Choose Glass chimes, Warm piano, Singing bowl, Harp cascade, Water droplets, Soft pulse or Silent. They use layered instruments with soft attacks and bounded echo tails, rather than a loud square-wave siren. Selecting a sound is silent; Preview plays one phrase, limited to three seconds.

Settings includes the normal alarm duration (0 means until dismissed), the duration when music was playing (3 seconds by default), and the interval between repeated phrases. Cadence captures music playback before the focus-to-break pause. Scheduled audio stops at the cap even if a browser timer is late. The alarm notice shows a sound countdown and remains available after the sound finishes. See the [Web Audio scheduling reference](https://developer.mozilla.org/en-US/docs/Web/API/AudioScheduledSourceNode/stop).

## Spotify

### Windows desktop: works with Spotify Free

Settings → Spotify defaults to **Windows desktop**. Download the helper ZIP from Settings, unzip it and run Start-Cadence-Desktop.cmd. Its local page has a Show pairing code button for the temporary code. Paste that code in Cadence and connect. Choose a song in Spotify first. No developer app, Premium subscription, Spotify login, third-party package or admin rights are needed for this route.

The helper page and compact player have a **Like / unlike song** button using [Spotify's documented Alt+Shift+B shortcut](https://support.spotify.com/us/article/keyboard-shortcuts/). It brings Spotify to the front and toggles the song's saved state. It is not an add-only action: an already liked song can be unliked. The helper checks that the song has not changed and that Spotify has focus before sending the shortcut; rapid double clicks are ignored. It never sends playback keys for this action. The helper page can use this button before timer pairing. Update and restart the helper to get these controls.

Title, artist and artwork refresh every two seconds. Metadata polling starts when the timer becomes signed in, even if desktop pairing finished earlier, and routine settings/sync updates do not restart its interval. Helper playback and metadata checks remain separate from the Like/Unlike action.

The helper uses [Windows media sessions](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession) to target Spotify, including play, pause, previous/next, seeking, metadata and available album artwork. It never sends a system-wide media-key toggle. Controls that Spotify disables, including restrictions during ads or on Free accounts, remain unavailable.

It binds only to 127.0.0.1:17842, checks the request host and origin, and requires a random per-run pairing code and a paired-tab ID. The code stays in tab session storage and is never synced to Cloudflare. The browser may ask for local-network permission. The helper owns the absolute focus deadline and a heartbeat lease, allowing background-browser throttling. It pauses on a close signal or within 90 seconds of lost contact, or at the focus deadline, whichever comes first. It pauses once at a timer boundary, then releases control; manually restarted desktop playback is respected while idle. Pairing itself does not take over playback. It runs hidden and does not install a Windows startup task. Stop it from its local page.

### Optional Web API: Premium required

The Web API route remains available in Settings for other devices. It uses a Spotify Developer app’s public Client ID and PKCE authorization; no client secret is needed. This route requires [Spotify Premium and the app’s applicable allowlist](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

Both routes offer Off, Hide (controls only), Minimalist, Full, or album-cover-only layouts and an optional song name. Music resumes only during a running focus interval. Pause/reset, breaks, alarms, Off, disconnect and sign-out pause it. A manual music pause lasts until the next focus block. Cadence and the chosen connection must remain available for automation.

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

`npm test` runs analytics, art scene rendering, timer/appearance regressions, mocked Spotify playback checks, and local Worker API tests. Spotify checks use a fake clock and mocked transport, not a live Spotify account. The Python browser checks in `test/browser.test.py` need Playwright and a Chrome executable and are not part of that command.

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

