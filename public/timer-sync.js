/* Shared account timer: transitions are saved immediately; ticks use one deadline.
 * Pending transitions survive reloads. Compare-and-swap rejects stale devices,
 * and completing an interval saves history atomically with the next round. */
(function () {
  'use strict';
  window.CadenceTimerSync = class {
    constructor(store, onChange) {
      this.store = store;
      this.workspace = store.workspaceId;
      this.onChange = onChange;
      this.key = 'cadence.shared-timer.' + this.workspace;
      this.queue = [];
      this.offset = 0;
      try {
        const cache = JSON.parse(localStorage.getItem(this.key) || 'null');
        if (cache) { this.timer = cache.timer; this.queue = cache.queue || []; }
      } catch (_) {}
      this.wake = () => { void this.sync(); };
      this.storage = event => { if (event.key === this.key) this.wake(); };
      this.visibility = () => { if (!document.hidden) this.wake(); };
      window.addEventListener('storage', this.storage);
      window.addEventListener('online', this.wake);
      document.addEventListener('visibilitychange', this.visibility);
      try {
        this.channel = new BroadcastChannel('cadence-timer-' + this.workspace);
        this.channel.onmessage = this.wake;
      } catch (_) {}
      this.poll = setInterval(() => {
        if (document.hidden && Date.now() - (this.lastPoll || 0) < 5000) return;
        this.lastPoll = Date.now(); this.wake();
      }, 1000);
      this.ready = this.sync().then(() => { if (!this.closed) this.notify(); });
    }
    now() { return Date.now() + this.offset; }
    persist() {
      try { localStorage.setItem(this.key, JSON.stringify({ timer: this.timer, queue: this.queue })); } catch (_) {}
    }
    notify() {
      if (this.closed) return;
      this.store.setLiveTimer(this.timer || null, this.offset);
      this.onChange(this.timer || null);
    }
    save(snapshot, session) {
      if (this.closed) return;
      const timer = { ...snapshot, changeId: crypto.randomUUID() };
      this.queue.push({ baseChangeId: this.timer?.changeId || null, timer, session: session || null });
      this.timer = timer;
      this.persist();
      this.store.setLiveTimer(timer, this.offset);
      void this.sync();
    }
    async request(method, operation) {
      const start = Date.now();
      const response = await fetch((window.CADENCE_API || '') + '/api/workspaces/' + this.workspace + '/timer', {
        method, cache: 'no-store', signal: AbortSignal.timeout(10000),
        headers: { 'Content-Type': 'application/json' },
        ...(operation ? { body: JSON.stringify(operation) } : {}),
      });
      if (!response.ok && response.status !== 409) throw Error('Timer sync ' + response.status);
      const body = await response.json();
      this.offset = body.serverTime - (start + Date.now()) / 2;
      return body;
    }
    async sync() {
      if (this.closed || this.busy || this.retryAt > Date.now()) return;
      this.busy = true;
      try {
        while (this.queue.length && !this.closed) {
          const operation = this.queue[0];
          const result = await this.request('PUT', operation);
          if (this.closed) return;
          if (!result.accepted) {
            this.queue = [];
            this.timer = result.timer;
            this.persist();
            this.notify();
            void this.store.forceSync();
            break;
          }
          this.queue.shift();
          // The session is already durable; update this browser's history too.
          if (operation.session) this.store.logSession(operation.session);
          if (!this.queue.length) this.timer = result.timer;
          this.persist();
          this.channel?.postMessage({ changed: true });
        }
        if (this.closed) return;
        const result = await this.request('GET');
        if (this.closed || this.queue.length) return;
        const changed = JSON.stringify(result.timer) !== JSON.stringify(this.timer);
        const intervalChanged = this.timer?.id !== result.timer?.id;
        this.timer = result.timer;
        if (changed) this.persist();
        this.notify();
        if (intervalChanged) void this.store.forceSync();
        this.failures = 0;
        this.retryAt = 0;
      } catch (_) {
        this.failures = Math.min((this.failures || 0) + 1, 6);
        this.retryAt = Date.now() + Math.min(30000, 1000 * 2 ** this.failures);
      } finally {
        this.busy = false;
      }
    }
    close() {
      this.closed = true;
      clearInterval(this.poll);
      this.channel?.close();
      window.removeEventListener('storage', this.storage);
      window.removeEventListener('online', this.wake);
      document.removeEventListener('visibilitychange', this.visibility);
    }
  };
})();
