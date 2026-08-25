/* Cadence — persistence and sync layer.
 *
 * "Persisting across multiple places" is handled at three levels, each of
 * which degrades gracefully to the one below it:
 *
 *   1. localStorage    survives reload and works with no network at all
 *   2. BroadcastChannel  every open tab in this browser stays in step live
 *   3. HTTP API        survives cache clears and reaches other devices
 *
 * Writes are local-first: the UI never waits on the network. Mutations land
 * in localStorage, fan out to sibling tabs, and queue in an outbox that
 * drains to the server with backoff.
 *
 * Sessions are an append-only log of immutable events keyed by a
 * client-generated UUID, so merging two devices is a set union and a retried
 * request can never double-count. Tasks and settings are small
 * human-edited documents, so per-record last-write-wins on updatedAt is
 * enough for them.
 */
(function () {
  'use strict';

  var API = window.CADENCE_API || '';
  var LS_WORKSPACE = 'cadence.workspace';
  var LS_DEVICE = 'cadence.device';
  var LS_USER = 'cadence.user';
  var CACHE_PREFIX = 'cadence.cache.';
  var CHANNEL = 'cadence-sync';

  /* ---------------------------------------------------------------- *
   * small utilities
   * ---------------------------------------------------------------- */

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function safeLS(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  /** Local calendar date, not UTC — day boundaries must follow the user. */
  function localDate(d) {
    d = d || new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  /* ---------------------------------------------------------------- *
   * identity
   * ---------------------------------------------------------------- */

  /* Identity is now an account: a name and a PIN. The server maps that pair
   * to a workspace id, so signing in on a second device fetches the same
   * workspace instead of provisioning an empty one — which is exactly what the
   * old ?w= share link did, minus the part where the credential travelled in a
   * URL that lands in history, screenshots and referrer headers.
   *
   * The workspace id is still the API's bearer credential; the account is what
   * gates access to it. Nothing is stored beyond the name and the id — the
   * PIN is sent once per sign-in and never written down here. */

  var deviceId = safeLS(function () {
    var d = localStorage.getItem(LS_DEVICE);
    if (!d) {
      d = uuid();
      localStorage.setItem(LS_DEVICE, d);
    }
    return d;
  }, uuid());

  var userName = safeLS(function () { return localStorage.getItem(LS_USER); }, null);
  var workspaceId = userName
    ? safeLS(function () { return localStorage.getItem(LS_WORKSPACE); }, null)
    : null;

  // A name with no workspace (or the reverse) is a half-written sign-in from an
  // interrupted write. Treat it as signed out rather than syncing into limbo.
  if (!userName || !workspaceId) {
    userName = null;
    workspaceId = null;
  }

  /* ---------------------------------------------------------------- *
   * state
   * ---------------------------------------------------------------- */

  var DEFAULT_SETTINGS = {
    durations: { focus: 25, short: 5, long: 15 },
    autoStart: true,
    sound: true,
    volume: 0.7,
    alarmSound: 'chime',
    theme: 'graphite',
    updatedAt: 0,
  };

  var state = {
    sessions: [],
    tasks: [],
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    analytics: null,
    online: navigator.onLine !== false,
    syncedAt: 0,
    workspaceId: workspaceId,
    user: userName,
    authError: null,
    authBusy: false,
  };

  var syncedSessionIds = Object.create(null);
  var dirty = { tasks: false, settings: false };
  var subscribers = [];

  function emit() {
    for (var i = 0; i < subscribers.length; i++) {
      try {
        subscribers[i](state);
      } catch (e) {
        console.error('[cadence] subscriber failed', e);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * local cache
   * ---------------------------------------------------------------- */

  function cacheKey() {
    return CACHE_PREFIX + (workspaceId || 'local');
  }

  function saveLocal() {
    safeLS(function () {
      localStorage.setItem(
        cacheKey(),
        JSON.stringify({
          v: 1,
          sessions: state.sessions,
          tasks: state.tasks,
          settings: state.settings,
          syncedSessionIds: Object.keys(syncedSessionIds),
          dirty: dirty,
          savedAt: Date.now(),
        })
      );
    });
  }

  function loadLocal() {
    var raw = safeLS(function () { return localStorage.getItem(cacheKey()); }, null);
    if (!raw) return false;
    try {
      var c = JSON.parse(raw);
      if (Array.isArray(c.sessions)) state.sessions = c.sessions;
      if (Array.isArray(c.tasks)) state.tasks = c.tasks;
      if (c.settings) state.settings = Object.assign({}, DEFAULT_SETTINGS, c.settings);
      (c.syncedSessionIds || []).forEach(function (id) { syncedSessionIds[id] = true; });
      if (c.dirty) dirty = c.dirty;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------- *
   * cross-tab
   * ---------------------------------------------------------------- */

  var channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = function (ev) {
      var msg = ev.data;
      if (!msg || msg.deviceId === deviceId) return;
      if (msg.type === 'state') {
        mergeSessions(msg.sessions || []);
        mergeTasks(msg.tasks || []);
        mergeSettings(msg.settings);
        recomputeAnalytics();
        emit();
      }
    };
  } catch (e) {
    /* Safari private mode and old browsers: storage events below still work. */
  }

  function broadcast() {
    if (!channel) return;
    try {
      channel.postMessage({
        type: 'state',
        deviceId: deviceId,
        sessions: state.sessions.slice(-200),
        tasks: state.tasks,
        settings: state.settings,
      });
    } catch (e) {}
  }

  // Fallback for browsers without BroadcastChannel: another tab writing the
  // same cache key fires a storage event here.
  window.addEventListener('storage', function (ev) {
    if (ev.key !== cacheKey() || !ev.newValue) return;
    try {
      var c = JSON.parse(ev.newValue);
      mergeSessions(c.sessions || []);
      mergeTasks(c.tasks || []);
      mergeSettings(c.settings);
      recomputeAnalytics();
      emit();
    } catch (e) {}
  });

  /* ---------------------------------------------------------------- *
   * merge
   * ---------------------------------------------------------------- */

  function mergeSessions(incoming) {
    if (!incoming || !incoming.length) return 0;
    var seen = Object.create(null);
    for (var i = 0; i < state.sessions.length; i++) seen[state.sessions[i].id] = true;
    var added = 0;
    for (var j = 0; j < incoming.length; j++) {
      var s = incoming[j];
      if (!s || !s.id || seen[s.id]) continue;
      seen[s.id] = true;
      state.sessions.push(s);
      added++;
    }
    if (added) {
      state.sessions.sort(function (a, b) { return a.endedAt - b.endedAt; });
    }
    return added;
  }

  function mergeTasks(incoming) {
    if (!incoming || !incoming.length) return;
    var byId = Object.create(null);
    for (var i = 0; i < state.tasks.length; i++) byId[state.tasks[i].id] = state.tasks[i];
    for (var j = 0; j < incoming.length; j++) {
      var t = incoming[j];
      if (!t || t.id == null) continue;
      var cur = byId[t.id];
      if (!cur || (t.updatedAt || 0) > (cur.updatedAt || 0)) byId[t.id] = t;
    }
    state.tasks = Object.keys(byId)
      .map(function (k) { return byId[k]; })
      .sort(function (a, b) {
        return (a.sortIndex || 0) - (b.sortIndex || 0) || (a.updatedAt || 0) - (b.updatedAt || 0);
      });
  }

  function mergeSettings(incoming) {
    if (!incoming) return;
    if ((incoming.updatedAt || 0) > (state.settings.updatedAt || 0)) {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, incoming);
    }
  }

  /* ---------------------------------------------------------------- *
   * analytics
   * ---------------------------------------------------------------- */

  function recomputeAnalytics() {
    if (!window.CadenceAnalytics) return;
    state.analytics = window.CadenceAnalytics.computeAnalytics(state.sessions, localDate(), {
      goal: 10,
    });
  }

  /* ---------------------------------------------------------------- *
   * network
   * ---------------------------------------------------------------- */

  function api(path, options) {
    var opts = Object.assign({ headers: { 'Content-Type': 'application/json' } }, options || {});
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctl) opts.signal = ctl.signal;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : null;
    return fetch(API + path, opts)
      .then(function (r) {
        if (timer) clearTimeout(timer);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        throw err;
      });
  }

  /* Workspaces are no longer provisioned on sight — one is created by
   * registering an account, and reached afterwards by signing in. A signed-out
   * tab simply has nothing to sync, which is not an error. */
  function ensureWorkspace() {
    return Promise.resolve(workspaceId || null);
  }

  /* ---------------------------------------------------------------- *
   * auth
   * ---------------------------------------------------------------- */

  /* The API reports failures as codes, not prose, so the wording of a bad
   * sign-in lives here next to the UI that shows it. */
  var AUTH_MESSAGES = {
    bad_name: 'Enter a name of 40 characters or fewer.',
    bad_pin: 'PIN must be 4–8 digits.',
    name_taken: 'That name is already taken.',
    no_such_user: 'No account with that name.',
    bad_credentials: 'That PIN does not match.',
    rate_limited: 'Too many attempts. Try again in a few minutes.',
  };

  function authRequest(kind, name, pin, isNew) {
    if (state.authBusy) return Promise.resolve(false);
    state.authBusy = true;
    state.authError = null;
    emit();

    return fetch(API + '/api/auth/' + kind, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, pin: pin }),
    })
      .then(function (r) {
        return r.json().then(
          function (body) { return { ok: r.ok, body: body }; },
          function () { return { ok: false, body: {} }; }
        );
      })
      .then(function (res) {
        if (!res.ok) {
          state.authError = AUTH_MESSAGES[res.body.error] || 'Something went wrong. Try again.';
          return false;
        }
        adoptAccount(res.body.name, res.body.workspaceId, isNew);
        return true;
      })
      .catch(function () {
        // Distinct from a rejected PIN: the request never landed.
        state.authError = 'Cannot reach the server. Check your connection.';
        return false;
      })
      .then(function (ok) {
        state.authBusy = false;
        emit();
        if (ok) sync();
        return ok;
      });
  }

  /* Switch the running store over to a workspace. Everything derived from the
   * previous one is dropped first, so signing into a second account can never
   * show the first account's numbers even for a frame. */
  function adoptAccount(name, id, isNew) {
    userName = name;
    workspaceId = id;
    syncedSessionIds = Object.create(null);
    dirty = { tasks: false, settings: false };
    state.sessions = [];
    state.tasks = [];
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    state.analytics = null;
    state.workspaceId = id;
    state.user = name;

    safeLS(function () {
      localStorage.setItem(LS_USER, name);
      localStorage.setItem(LS_WORKSPACE, id);
    });

    // The cache is workspace-scoped, so this restores anything this device
    // already held for the account — including while offline.
    var hadCache = loadLocal();
    if (!hadCache && isNew) seedTasks();
    recomputeAnalytics();
  }

  function pull() {
    if (!workspaceId) return Promise.resolve();
    return api('/api/workspaces/' + workspaceId + '/state').then(function (res) {
      mergeSessions(res.sessions || []);
      // Server rows are authoritative for anything we have already pushed.
      (res.sessions || []).forEach(function (s) { syncedSessionIds[s.id] = true; });
      if (!dirty.tasks) mergeTasks(res.tasks || []);
      if (!dirty.settings && res.settings) {
        mergeSettings(Object.assign({}, res.settings, { updatedAt: res.settingsUpdatedAt }));
      }
      state.syncedAt = Date.now();
      state.online = true;
    });
  }

  function push() {
    if (!workspaceId) return Promise.resolve();
    var jobs = [];

    var unsent = state.sessions.filter(function (s) { return !syncedSessionIds[s.id]; });
    if (unsent.length) {
      jobs.push(
        api('/api/workspaces/' + workspaceId + '/sessions', {
          method: 'POST',
          body: JSON.stringify({ sessions: unsent.slice(0, 500) }),
        }).then(function () {
          unsent.forEach(function (s) { syncedSessionIds[s.id] = true; });
        })
      );
    }

    if (dirty.tasks) {
      jobs.push(
        api('/api/workspaces/' + workspaceId + '/tasks', {
          method: 'PUT',
          body: JSON.stringify({ tasks: state.tasks }),
        }).then(function (res) {
          dirty.tasks = false;
          mergeTasks(res.tasks || []);
        })
      );
    }

    if (dirty.settings) {
      jobs.push(
        api('/api/workspaces/' + workspaceId + '/settings', {
          method: 'PUT',
          body: JSON.stringify({
            settings: state.settings,
            updatedAt: state.settings.updatedAt || Date.now(),
          }),
        }).then(function () {
          dirty.settings = false;
        })
      );
    }

    return jobs.length ? Promise.all(jobs) : Promise.resolve();
  }

  function pullAnalytics() {
    if (!workspaceId) return Promise.resolve();
    return api(
      '/api/workspaces/' + workspaceId + '/analytics?today=' + encodeURIComponent(localDate())
    ).then(function (res) {
      state.analytics = res;
    });
  }

  /* Outbox drain. Backoff keeps a dead server from hammering the network
   * while the app stays fully usable from the local cache. */
  var backoff = 0;
  var syncTimer = null;
  var syncing = false;

  function scheduleSync(delay) {
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(sync, delay == null ? 800 : delay);
  }

  function sync() {
    if (syncing) return Promise.resolve();
    // Signed out: nothing to push, nothing to pull, and no backoff to start.
    if (!workspaceId) return Promise.resolve();
    syncing = true;
    return ensureWorkspace()
      .then(push)
      .then(pull)
      .then(pullAnalytics)
      .then(function () {
        backoff = 0;
        state.online = true;
        saveLocal();
        emit();
      })
      .catch(function (err) {
        state.online = false;
        // Offline is a normal mode here, not an error state: the local
        // analytics fallback keeps every number correct until we reconnect.
        recomputeAnalytics();
        saveLocal();
        emit();
        backoff = Math.min(backoff ? backoff * 2 : 4000, 120000);
        scheduleSync(backoff);
      })
      .then(function () {
        syncing = false;
      });
  }

  window.addEventListener('online', function () {
    backoff = 0;
    scheduleSync(200);
  });
  window.addEventListener('offline', function () {
    state.online = false;
    emit();
  });

  // Flush anything queued before the tab goes away.
  window.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      saveLocal();
      if (workspaceId && navigator.sendBeacon) {
        var unsent = state.sessions.filter(function (s) { return !syncedSessionIds[s.id]; });
        if (unsent.length) {
          try {
            navigator.sendBeacon(
              API + '/api/workspaces/' + workspaceId + '/sessions',
              new Blob([JSON.stringify({ sessions: unsent })], { type: 'application/json' })
            );
          } catch (e) {}
        }
      }
    } else {
      scheduleSync(300);
    }
  });

  setInterval(function () { scheduleSync(0); }, 60000);

  /* ---------------------------------------------------------------- *
   * seed
   * ---------------------------------------------------------------- */

  /* A brand-new workspace starts with the same four tasks the mockup shipped
   * with, so a first visit looks exactly like the approved design. */
  function seedTasks() {
    var now = Date.now();
    var seed = [
      ['Draft Q3 positioning memo', 'DEEP WORK', true, false],
      ['Rework onboarding wave animation', 'DESIGN', false, true],
      ['Review pull requests', 'ADMIN', false, false],
      ['Sketch analytics empty states', 'DESIGN', false, false],
    ];
    state.tasks = seed.map(function (row, i) {
      return {
        id: uuid(),
        name: row[0],
        category: row[1],
        done: row[2],
        pinned: row[3],
        deleted: false,
        sortIndex: i,
        updatedAt: now + i,
      };
    });
    dirty.tasks = true;
  }

  /* ---------------------------------------------------------------- *
   * public API
   * ---------------------------------------------------------------- */

  function touch() {
    recomputeAnalytics();
    saveLocal();
    broadcast();
    emit();
    scheduleSync();
  }

  var store = {
    deviceId: deviceId,

    getState: function () {
      return state;
    },

    get workspaceId() {
      return workspaceId;
    },

    subscribe: function (fn) {
      subscribers.push(fn);
      return function () {
        var i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },

    /** Sign in to an existing account. Same name and PIN on any device
     *  resolves to the same workspace, so history follows the person. */
    login: function (name, pin) {
      return authRequest('login', name, pin, false);
    },

    /** Create an account. The server provisions a fresh workspace for it, and
     *  we seed it with the sample stack so a first visit matches the design. */
    register: function (name, pin) {
      return authRequest('register', name, pin, true);
    },

    /** Drop the local session. Cached data stays keyed to its own workspace, so
     *  signing back in on this device picks it up again without a round trip. */
    logout: function () {
      saveLocal();
      userName = null;
      workspaceId = null;
      syncedSessionIds = Object.create(null);
      dirty = { tasks: false, settings: false };
      state.sessions = [];
      state.tasks = [];
      state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      state.analytics = null;
      state.workspaceId = null;
      state.user = null;
      state.authError = null;
      safeLS(function () {
        localStorage.removeItem(LS_USER);
        localStorage.removeItem(LS_WORKSPACE);
      });
      recomputeAnalytics();
      emit();
    },

    /** Append one immutable interval to the log. */
    logSession: function (evt) {
      var ended = evt.endedAt || Date.now();
      var record = {
        id: uuid(),
        mode: evt.mode,
        seconds: Math.max(0, Math.round(evt.seconds || 0)),
        planned: Math.round(evt.planned || 0),
        completed: evt.completed !== false,
        taskId: evt.taskId || null,
        category: evt.category || null,
        startedAt: evt.startedAt || ended - (evt.seconds || 0) * 1000,
        endedAt: ended,
        localDate: localDate(new Date(ended)),
        deviceId: deviceId,
      };
      state.sessions.push(record);
      touch();
      return record;
    },

    addTask: function (name, category) {
      var t = {
        id: uuid(),
        name: name,
        category: (category || 'UNSORTED').toUpperCase(),
        done: false,
        pinned: false,
        deleted: false,
        sortIndex: state.tasks.length,
        updatedAt: Date.now(),
      };
      state.tasks.push(t);
      dirty.tasks = true;
      touch();
      return t;
    },

    updateTask: function (id, patch) {
      state.tasks = state.tasks.map(function (t) {
        return t.id === id ? Object.assign({}, t, patch, { updatedAt: Date.now() }) : t;
      });
      dirty.tasks = true;
      touch();
    },

    /** Tombstone rather than splice — a delete has to replicate too. */
    deleteTask: function (id) {
      state.tasks = state.tasks.map(function (t) {
        return t.id === id
          ? Object.assign({}, t, { deleted: true, pinned: false, updatedAt: Date.now() })
          : t;
      });
      dirty.tasks = true;
      touch();
    },

    pinTask: function (id) {
      var now = Date.now();
      state.tasks = state.tasks.map(function (t) {
        var want = t.id === id ? !t.pinned : false;
        return t.pinned === want ? t : Object.assign({}, t, { pinned: want, updatedAt: now });
      });
      dirty.tasks = true;
      touch();
    },

    saveSettings: function (patch) {
      state.settings = Object.assign({}, state.settings, patch, { updatedAt: Date.now() });
      dirty.settings = true;
      touch();
    },

    getAnalytics: function () {
      return state.analytics;
    },

    forceSync: function () {
      return sync();
    },
  };

  /* ---------------------------------------------------------------- *
   * boot
   * ---------------------------------------------------------------- */

  /* Signed out, there is nothing to restore and nothing to ask the server for:
   * the app opens on the sign-in screen. Signed in, the workspace-scoped cache
   * comes back first so the UI is populated before the network is consulted. */
  if (workspaceId) {
    loadLocal();
    recomputeAnalytics();
  }

  store.ready = Promise.resolve()
    .then(function () {
      return workspaceId ? sync() : null;
    })
    .catch(function () {
      // Server unreachable at boot: run entirely from the local cache.
      state.online = false;
      recomputeAnalytics();
      emit();
      scheduleSync(4000);
    })
    .then(function () {
      return state;
    });

  window.CadenceStore = store;
})();
