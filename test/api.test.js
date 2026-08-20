'use strict';

/* End-to-end HTTP tests against the real Worker + local D1 emulation, driven
 * through `wrangler dev`. No Cloudflare account or network access needed —
 * `wrangler dev` runs entirely locally (Miniflare) unless given --remote. */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 8799;
const BASE = 'http://127.0.0.1:' + PORT;
const WRANGLER = process.platform === 'win32' ? 'npx.cmd' : 'npx';

let passed = 0;
const results = [];
function test(name, fn) {
  results.push({ name, fn });
}

const j = (p, options) =>
  fetch(BASE + p, Object.assign({ headers: { 'Content-Type': 'application/json' } }, options)).then(
    async (r) => ({ status: r.status, body: await r.json() })
  );

const uuid = () => crypto.randomUUID();
const TODAY = '2026-08-18';

const session = (over) =>
  Object.assign(
    {
      id: uuid(),
      mode: 'focus',
      seconds: 1500,
      planned: 1500,
      completed: true,
      category: 'DEEP WORK',
      startedAt: Date.now() - 1500000,
      endedAt: Date.now(),
      localDate: TODAY,
    },
    over
  );

/** Looks up a user's stored pin_hash straight from the local D1 file, so the
 *  "never stored in the clear" check doesn't depend on any HTTP surface.
 *  Goes through a temp --file rather than --command: on Windows, --command
 *  has to survive a cmd.exe shell hop that mangles quoting. */
function pinHashFor(nameLower) {
  const sqlFile = path.join(os.tmpdir(), 'cadence-pinhash-' + crypto.randomUUID() + '.sql');
  fs.writeFileSync(sqlFile, `SELECT pin_hash FROM users WHERE name_lower = '${nameLower}';`);
  try {
    const out = execFileSync(
      WRANGLER,
      ['wrangler', 'd1', 'execute', 'cadence', '--local', '--json', '--file', sqlFile],
      { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' }
    );
    const parsed = JSON.parse(out);
    const rows = parsed[0] && parsed[0].results;
    return rows && rows[0] ? rows[0].pin_hash : null;
  } finally {
    fs.unlinkSync(sqlFile);
  }
}

/* ------------------------------------------------------------------ */

test('health check responds', async () => {
  const r = await j('/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
});

test('registering returns a name and a fresh workspace', async () => {
  const name = 'ada-' + uuid().slice(0, 8);
  const r = await j('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, pin: '1234' }),
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.name, name);
  assert.match(r.body.workspaceId, /^[0-9a-f-]{36}$/);
});

test('signing in resolves to the same workspace, case-insensitively', async () => {
  const name = 'Grace-' + uuid().slice(0, 8);
  const reg = await j('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, pin: '774411' }),
  });

  const login = await j('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ name: name.toUpperCase(), pin: '774411' }),
  });
  assert.strictEqual(login.status, 200);
  assert.strictEqual(login.body.workspaceId, reg.body.workspaceId);
  assert.strictEqual(login.body.name, name, 'display casing is preserved as typed');
});

test('a taken name is refused regardless of casing', async () => {
  const name = 'Linus-' + uuid().slice(0, 8);
  await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, pin: '1111' }) });
  const dup = await j('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name: name.toLowerCase(), pin: '2222' }),
  });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.error, 'name_taken');
});

test('a wrong pin and an unknown name are both refused', async () => {
  const name = 'Alan-' + uuid().slice(0, 8);
  await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, pin: '4321' }) });

  const wrong = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ name, pin: '9999' }) });
  assert.strictEqual(wrong.status, 401);
  assert.strictEqual(wrong.body.error, 'bad_credentials');
  assert.ok(!wrong.body.workspaceId, 'a failed login must not leak the workspace');

  const missing = await j('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ name: 'nobody-' + uuid().slice(0, 8), pin: '1234' }),
  });
  assert.strictEqual(missing.status, 404);
});

test('registration validates the name and pin bounds', async () => {
  const bad = (body) => j('/api/auth/register', { method: 'POST', body: JSON.stringify(body) });

  assert.strictEqual((await bad({ name: '   ', pin: '1234' })).status, 400);
  assert.strictEqual((await bad({ pin: '1234' })).status, 400);
  assert.strictEqual((await bad({ name: 'x'.repeat(41), pin: '1234' })).status, 400);
  assert.strictEqual((await bad({ name: 'Shorty', pin: '12' })).status, 400);
  assert.strictEqual((await bad({ name: 'Lettery', pin: 'abcd' })).status, 400);
  assert.strictEqual((await bad({ name: 'Nopin' })).status, 400);
});

test('the pin is never stored in the clear', async () => {
  const name = 'Vault-' + uuid().slice(0, 8);
  const secret = '135790';
  await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ name, pin: secret }) });

  const stored = pinHashFor(name.toLowerCase());
  assert.ok(stored, 'user was written');
  assert.ok(!stored.includes(secret), 'stored value must not contain the pin');
  assert.match(stored, /^[0-9a-f]{32}:[0-9a-f]+$/, 'salt:hash, hex encoded');

  const other = 'Vault-' + uuid().slice(0, 8);
  await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: other, pin: secret }) });
  const stored2 = pinHashFor(other.toLowerCase());
  assert.notStrictEqual(stored, stored2, 'salts must differ');
});

test('workspace creation returns a usable id', async () => {
  const r = await j('/api/workspaces', { method: 'POST', body: '{}' });
  assert.strictEqual(r.status, 201);
  assert.match(r.body.id, /^[0-9a-f-]{36}$/);
});

test('unknown workspace 404s and a malformed id 400s', async () => {
  assert.strictEqual((await j('/api/workspaces/' + uuid() + '/state')).status, 404);
  assert.strictEqual((await j('/api/workspaces/not-a-uuid/state')).status, 400);
});

test('sessions round-trip and survive a fresh read', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  const s = session();
  const post = await j('/api/workspaces/' + ws.id + '/sessions', {
    method: 'POST',
    body: JSON.stringify({ sessions: [s] }),
  });
  assert.strictEqual(post.body.written, 1);

  const state = await j('/api/workspaces/' + ws.id + '/state');
  assert.strictEqual(state.body.sessions.length, 1);
  assert.strictEqual(state.body.sessions[0].id, s.id);
  assert.strictEqual(state.body.sessions[0].seconds, 1500);
});

test('replaying the same session id never double-counts', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  const s = session();
  const payload = { method: 'POST', body: JSON.stringify({ sessions: [s, s] }) };
  const first = await j('/api/workspaces/' + ws.id + '/sessions', payload);
  const second = await j('/api/workspaces/' + ws.id + '/sessions', payload);

  assert.strictEqual(first.body.written, 1, 'duplicate inside one batch collapses');
  assert.strictEqual(second.body.written, 0, 'retrying the whole batch is a no-op');

  const state = await j('/api/workspaces/' + ws.id + '/state');
  assert.strictEqual(state.body.sessions.length, 1);
});

test('malformed sessions are rejected without poisoning the batch', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  const r = await j('/api/workspaces/' + ws.id + '/sessions', {
    method: 'POST',
    body: JSON.stringify({
      sessions: [
        session(),
        session({ mode: 'nap' }),
        session({ localDate: 'yesterday' }),
        session({ seconds: -5 }),
        session({ seconds: 999999 }),
        { id: 'nope' },
      ],
    }),
  });
  assert.strictEqual(r.body.written, 1);
  assert.strictEqual(r.body.rejected, 5);
});

test('analytics are computed server-side from the log', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  await j('/api/workspaces/' + ws.id + '/sessions', {
    method: 'POST',
    body: JSON.stringify({
      sessions: [
        session({ seconds: 7200, category: 'DEEP WORK' }),
        session({ seconds: 4800, category: 'DESIGN' }),
        session({ seconds: 3600, localDate: '2026-08-17', category: 'ADMIN' }),
      ],
    }),
  });

  const a = (await j('/api/workspaces/' + ws.id + '/analytics?today=' + TODAY)).body;
  assert.strictEqual(a.focusToday.text, '3h 20m');
  assert.strictEqual(a.sessionsToday.count, 2);
  assert.strictEqual(a.streak.days, 2);
  assert.strictEqual(a.categories[0].name, 'DEEP WORK');
  assert.strictEqual(a.week.totalText, '4.3H TOTAL');
});

test('analytics reject a missing or malformed date', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  assert.strictEqual((await j('/api/workspaces/' + ws.id + '/analytics')).status, 400);
  assert.strictEqual((await j('/api/workspaces/' + ws.id + '/analytics?today=18-08-2026')).status, 400);
});

test('tasks merge last-write-wins and keep tombstones', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  const id = uuid();

  await j('/api/workspaces/' + ws.id + '/tasks', {
    method: 'PUT',
    body: JSON.stringify({ tasks: [{ id, name: 'Write memo', category: 'DEEP WORK', updatedAt: 1000 }] }),
  });

  const stale = await j('/api/workspaces/' + ws.id + '/tasks', {
    method: 'PUT',
    body: JSON.stringify({ tasks: [{ id, name: 'STALE', updatedAt: 500 }] }),
  });
  assert.strictEqual(stale.body.tasks[0].name, 'Write memo');

  const fresh = await j('/api/workspaces/' + ws.id + '/tasks', {
    method: 'PUT',
    body: JSON.stringify({ tasks: [{ id, name: 'Write memo v2', updatedAt: 2000 }] }),
  });
  assert.strictEqual(fresh.body.tasks[0].name, 'Write memo v2');

  const gone = await j('/api/workspaces/' + ws.id + '/tasks', {
    method: 'PUT',
    body: JSON.stringify({ tasks: [{ id, name: 'Write memo v2', deleted: true, updatedAt: 3000 }] }),
  });
  assert.strictEqual(gone.body.tasks[0].deleted, true, 'delete must replicate, not vanish');
});

test('settings persist and resist stale overwrites', async () => {
  const { body: ws } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  const settings = { durations: { focus: 50, short: 10, long: 20 }, autoStart: false, sound: true, theme: 'ember' };

  await j('/api/workspaces/' + ws.id + '/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings, updatedAt: 5000 }),
  });
  const stale = await j('/api/workspaces/' + ws.id + '/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: { theme: 'mist' }, updatedAt: 100 }),
  });
  assert.strictEqual(stale.body.settings.theme, 'ember');

  const state = await j('/api/workspaces/' + ws.id + '/state');
  assert.strictEqual(state.body.settings.durations.focus, 50);
  assert.strictEqual(state.body.settings.autoStart, false);
});

test('two devices sharing a workspace converge; a third stays isolated', async () => {
  const { body: shared } = await j('/api/workspaces', { method: 'POST', body: '{}' });
  const { body: other } = await j('/api/workspaces', { method: 'POST', body: '{}' });

  await j('/api/workspaces/' + shared.id + '/sessions', {
    method: 'POST',
    body: JSON.stringify({ sessions: [session({ seconds: 1500, deviceId: 'laptop' })] }),
  });
  await j('/api/workspaces/' + shared.id + '/sessions', {
    method: 'POST',
    body: JSON.stringify({ sessions: [session({ seconds: 900, deviceId: 'phone' })] }),
  });
  await j('/api/workspaces/' + other.id + '/sessions', {
    method: 'POST',
    body: JSON.stringify({ sessions: [session({ seconds: 3600 })] }),
  });

  const a = (await j('/api/workspaces/' + shared.id + '/analytics?today=' + TODAY)).body;
  assert.strictEqual(a.sessionsToday.count, 2, 'both devices contribute');
  assert.strictEqual(a.focusToday.text, '40m');

  const b = (await j('/api/workspaces/' + other.id + '/analytics?today=' + TODAY)).body;
  assert.strictEqual(b.focusToday.text, '1h', 'other workspace must not leak in');
});

test('the app serves the pomodoro page at the root', async () => {
  const r = await fetch(BASE + '/');
  const html = await r.text();
  assert.strictEqual(r.status, 200);
  assert.ok(html.includes('<x-dc>'), 'design component root present');
  assert.ok(html.includes('sync.js'), 'sync layer linked');
});

/* ------------------------------------------------------------------ */

async function waitForServer(timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error('wrangler dev did not become ready in time');
}

(async () => {
  const win = process.platform === 'win32';

  console.log('\napplying local D1 schema…');
  execFileSync(WRANGLER, ['wrangler', 'd1', 'migrations', 'apply', 'cadence', '--local'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: win,
  });

  console.log('\nstarting wrangler dev on :' + PORT + ' …');
  const proc = spawn(WRANGLER, ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: win,
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));

  try {
    await waitForServer(30000);
    console.log('\napi end-to-end (Worker + local D1)');

    for (const { name, fn } of results) {
      try {
        await fn();
        passed++;
        console.log('  ok  ' + name);
      } catch (err) {
        console.error('  FAIL  ' + name + '\n        ' + err.message);
        process.exitCode = 1;
      }
    }

    console.log('\n' + passed + '/' + results.length + ' api tests passed');
  } catch (err) {
    console.error('\n' + err.message);
    console.error(log.slice(-4000));
    process.exitCode = 1;
  } finally {
    // On Windows, proc is the cmd.exe shell wrapper (spawned with shell:true);
    // killing it alone leaves the actual wrangler/workerd process tree running.
    // taskkill /T walks the whole tree instead.
    if (win) {
      try {
        execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        /* already gone */
      }
    } else {
      proc.kill();
    }
  }
})();
