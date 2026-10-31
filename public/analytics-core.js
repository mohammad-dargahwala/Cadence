/* Cadence — analytics core.
 *
 * Deliberately dependency-free and shared verbatim by the Express server and
 * the browser. The server runs it over rows from SQLite; the browser runs it
 * over the local event log when it is offline. One implementation means an
 * offline tab and the server can never disagree about what a number means.
 *
 * Dates are plain 'YYYY-MM-DD' strings in the *device's* local zone. Each
 * session carries the localDate it was recorded under, so day boundaries
 * follow the user rather than the server's clock.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CadenceAnalytics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;
  var WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

  function toKey(d) {
    return d.toISOString().slice(0, 10);
  }
  function parseKey(s) {
    return new Date(s + 'T00:00:00Z');
  }
  function shift(key, days) {
    return toKey(new Date(parseKey(key).getTime() + days * DAY));
  }
  /** Monday-based: Mon=0 … Sun=6, matching the MON–SUN bar labels. */
  function weekdayIndex(key) {
    return (parseKey(key).getUTCDay() + 6) % 7;
  }

  function hm(secs) {
    var total = Math.max(0, Math.round(secs || 0));
    var h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
    return [h ? h + 'h' : '', m ? m + 'm' : '', s ? s + 's' : ''].filter(Boolean).join(' ') || '0m';
  }

  /** U+2212 MINUS SIGN for negatives, matching the mockup's '−1m vs last week'. */
  function signedMinutes(deltaSecs) {
    var seconds = Math.round(deltaSecs);
    if (seconds === 0) return '0m';
    return (seconds > 0 ? '+' : '\u2212') + hm(Math.abs(seconds));
  }

  function computeStreak(byDate, today) {
    function has(k) {
      var d = byDate[k];
      return !!(d && d.n > 0);
    }
    // A day still in progress must not break a streak, so start counting at
    // today when it has sessions and at yesterday when it does not.
    var cursor = has(today) ? today : shift(today, -1);
    var streak = 0;
    while (has(cursor)) {
      streak++;
      cursor = shift(cursor, -1);
    }
    return streak;
  }

  function bestStreak(byDate) {
    var days = Object.keys(byDate)
      .filter(function (k) {
        return byDate[k].n > 0;
      })
      .sort();
    var best = 0;
    var run = 0;
    var prev = null;
    for (var i = 0; i < days.length; i++) {
      run = prev && shift(prev, 1) === days[i] ? run + 1 : 1;
      if (run > best) best = run;
      prev = days[i];
    }
    return best;
  }

  /**
   * @param {Array} sessions  event log; only completed focus intervals count
   * @param {string} today    'YYYY-MM-DD' in the viewing device's local zone
   */
  function computeAnalytics(sessions, today, opts) {
    opts = opts || {};
    var goal = Number(opts.goal) || 10;
    var list = Array.isArray(sessions) ? sessions.slice() : [];
    var timer = opts.timer;
    if (timer && timer.mode === 'focus' && !list.some(function (s) { return s.id && s.id === timer.id; })) {
      var now = opts.now == null ? Date.now() : opts.now;
      var left = timer.running ? Math.max(0, Math.ceil((timer.deadline - now) / 1000)) : timer.remaining;
      // Only completed minutes appear in the live total. Pauses do not add time,
      // and a closed browser can accrue at most the planned focus interval.
      var elapsed = Math.floor(Math.max(0, Math.min(timer.planned, timer.planned - left)) / 60) * 60;
      if (elapsed > 0) list.push({ id: timer.id, mode: 'focus', seconds: elapsed,
        category: timer.category, localDate: timer.localDate || today, completed: false });
    }

    var focus = list.filter(function (s) {
      return s && s.mode === 'focus' && Number(s.seconds) > 0 && s.localDate;
    });

    var byDate = {};
    for (var i = 0; i < focus.length; i++) {
      var s = focus[i];
      var d = byDate[s.localDate] || (byDate[s.localDate] = { secs: 0, n: 0 });
      d.secs += Number(s.seconds) || 0;
      d.n += 1;
    }
    function at(k) {
      return byDate[k] || { secs: 0, n: 0 };
    }

    var todayStats = at(today);
    var yesterday = at(shift(today, -1));

    /* -- current week, Monday-anchored ---------------------------------- */
    var weekStart = shift(today, -weekdayIndex(today));
    var weekKeys = [];
    for (var w = 0; w < 7; w++) weekKeys.push(shift(weekStart, w));

    var weekTotalSecs = weekKeys.reduce(function (a, k) {
      return a + at(k).secs;
    }, 0);
    var thisWeekCount = weekKeys.reduce(function (a, k) {
      return a + at(k).n;
    }, 0);

    var prevWeekStart = shift(weekStart, -7);
    var prevSecs = 0;
    var prevCount = 0;
    for (var p = 0; p < 7; p++) {
      var pd = at(shift(prevWeekStart, p));
      prevSecs += pd.secs;
      prevCount += pd.n;
    }

    var avgNow = thisWeekCount ? weekTotalSecs / thisWeekCount : 0;
    var avgPrev = prevCount ? prevSecs / prevCount : 0;

    var peakHours = weekKeys.reduce(function (m, k) {
      return Math.max(m, at(k).secs / 3600);
    }, 0);
    // Fixed 4h ceiling as in the original mockup, raised only when a real day
    // exceeds it so a heavy week can never overflow the 186px chart well.
    var ceiling = Math.max(4, Math.ceil(peakHours));
    var todayIdx = weekdayIndex(today);

    var bars = weekKeys.map(function (k, idx) {
      var hours = at(k).secs / 3600;
      return {
        date: k,
        label: WEEKDAYS[idx],
        hours: hours,
        val: hm(at(k).secs),
        heightPx: Math.round((hours / ceiling) * 150) + 12,
        isToday: idx === todayIdx,
      };
    });

    /* -- category split across the current week -------------------------- */
    var weekEnd = shift(weekStart, 6);
    var catTotals = {};
    for (var c = 0; c < focus.length; c++) {
      var f = focus[c];
      if (f.localDate < weekStart || f.localDate > weekEnd) continue;
      var key = String(f.category || 'UNSORTED').toUpperCase();
      catTotals[key] = (catTotals[key] || 0) + (Number(f.seconds) || 0);
    }
    var catSum = Object.keys(catTotals).reduce(function (a, k) {
      return a + catTotals[k];
    }, 0);
    var categories = Object.keys(catTotals)
      .sort(function (a, b) {
        return catTotals[b] - catTotals[a];
      })
      .slice(0, 4)
      .map(function (name) {
        return {
          name: name,
          seconds: catTotals[name],
          pct: catSum ? Math.round((catTotals[name] / catSum) * 100) : 0,
        };
      });

    var streak = computeStreak(byDate, today);
    var best = bestStreak(byDate);

    var allSecs = focus.reduce(function (a, f) {
      return a + (Number(f.seconds) || 0);
    }, 0);

    return {
      today: today,
      weekStart: weekStart,
      goal: goal,
      focusToday: {
        seconds: todayStats.secs,
        text: todayStats.secs ? hm(todayStats.secs) : '0m',
        deltaText: signedMinutes(todayStats.secs - yesterday.secs) + ' vs yesterday',
      },
      sessionsToday: {
        count: todayStats.n,
        text: String(todayStats.n),
        deltaText: 'goal ' + goal,
      },
      streak: {
        days: streak,
        best: best,
        text: streak + 'd',
        deltaText:
          streak > 0 && streak >= best
            ? 'personal best'
            : best
              ? 'best ' + best + 'd'
              : 'start today',
      },
      avgSession: {
        seconds: Math.round(avgNow),
        text: avgNow ? hm(avgNow) : '0m',
        deltaText: avgPrev
          ? signedMinutes(avgNow - avgPrev) + ' vs last week'
          : 'first full week',
      },
      week: {
        bars: bars,
        totalSeconds: weekTotalSecs,
        totalText: hm(weekTotalSecs).toUpperCase() + ' TOTAL',
        ceiling: ceiling,
      },
      categories: categories,
      allTime: { seconds: allSecs, sessions: focus.length },
    };
  }

  return { computeAnalytics: computeAnalytics, shift: shift, weekdayIndex: weekdayIndex };
});
