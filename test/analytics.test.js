'use strict';

const assert = require('assert');
const { computeAnalytics, shift } = require('../public/analytics-core.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('  FAIL  ' + name + '\n        ' + err.message);
    process.exitCode = 1;
  }
}

const TODAY = '2026-08-18'; // a Tuesday => weekday index 1
const mk = (localDate, minutes, category, completed) => ({
  mode: 'focus',
  seconds: minutes * 60,
  category: category || 'DEEP WORK',
  localDate,
  completed: completed !== false,
});

console.log('\nanalytics core');

test('empty log yields a fully zeroed but well-formed result', () => {
  const a = computeAnalytics([], TODAY);
  assert.strictEqual(a.focusToday.text, '0m');
  assert.strictEqual(a.sessionsToday.text, '0');
  assert.strictEqual(a.streak.days, 0);
  assert.strictEqual(a.week.bars.length, 7);
  assert.strictEqual(a.week.totalText, '0.0H TOTAL');
  assert.deepStrictEqual(a.categories, []);
});

test('focus today sums only today and formats as Xh Ym', () => {
  const a = computeAnalytics(
    [mk(TODAY, 120), mk(TODAY, 80), mk(shift(TODAY, -1), 45)],
    TODAY
  );
  assert.strictEqual(a.focusToday.text, '3h 20m');
  assert.strictEqual(a.sessionsToday.count, 2);
});

test('yesterday delta uses a real minus sign when negative', () => {
  const down = computeAnalytics([mk(TODAY, 10), mk(shift(TODAY, -1), 40)], TODAY);
  assert.strictEqual(down.focusToday.deltaText, '\u221230m vs yesterday');
  const up = computeAnalytics([mk(TODAY, 60), mk(shift(TODAY, -1), 18)], TODAY);
  assert.strictEqual(up.focusToday.deltaText, '+42m vs yesterday');
});

test('incomplete sessions are excluded from every total', () => {
  const a = computeAnalytics([mk(TODAY, 25), mk(TODAY, 25, 'DESIGN', false)], TODAY);
  assert.strictEqual(a.sessionsToday.count, 1);
  assert.strictEqual(a.focusToday.text, '25m');
});

test('week bars are Monday-anchored and flag today', () => {
  const a = computeAnalytics([mk(TODAY, 60)], TODAY);
  assert.strictEqual(a.weekStart, '2026-08-17'); // Monday
  assert.deepStrictEqual(
    a.week.bars.map((b) => b.label),
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
  );
  assert.strictEqual(a.week.bars[1].isToday, true);
  assert.strictEqual(a.week.bars[1].val, '1.0');
  assert.strictEqual(a.week.bars.filter((b) => b.isToday).length, 1);
});

test('bar heights stay inside the chart well even on a huge day', () => {
  const a = computeAnalytics([mk(TODAY, 11 * 60)], TODAY);
  const tallest = Math.max(...a.week.bars.map((b) => b.heightPx));
  assert.ok(tallest <= 162, 'tallest bar was ' + tallest);
  assert.ok(tallest >= 150, 'peak day should reach full height, got ' + tallest);
});

test('streak counts back from today and survives an unstarted today', () => {
  const days = [1, 2, 3].map((n) => mk(shift(TODAY, -n), 25));
  const a = computeAnalytics(days, TODAY);
  assert.strictEqual(a.streak.days, 3, 'today not yet started should not break it');

  const withToday = computeAnalytics(days.concat([mk(TODAY, 25)]), TODAY);
  assert.strictEqual(withToday.streak.days, 4);
});

test('a gap breaks the streak but is remembered as the best', () => {
  const a = computeAnalytics(
    [mk(shift(TODAY, -5), 25), mk(shift(TODAY, -4), 25), mk(shift(TODAY, -3), 25), mk(TODAY, 25)],
    TODAY
  );
  assert.strictEqual(a.streak.days, 1);
  assert.strictEqual(a.streak.best, 3);
  assert.strictEqual(a.streak.deltaText, 'best 3d');
});

test('category split sorts by time and sums to 100 across the ring', () => {
  const a = computeAnalytics(
    [mk(TODAY, 60, 'DEEP WORK'), mk(TODAY, 30, 'DESIGN'), mk(TODAY, 30, 'DESIGN'), mk(TODAY, 30, 'ADMIN')],
    TODAY
  );
  assert.strictEqual(a.categories[0].name, 'DEEP WORK');
  assert.strictEqual(a.categories[0].pct, 40);
  assert.strictEqual(a.categories[1].name, 'DESIGN');
  assert.strictEqual(a.categories.length, 3);
});

test('average session compares against the previous week', () => {
  const a = computeAnalytics(
    [mk(TODAY, 24), mk(TODAY, 24), mk(shift(TODAY, -7), 25), mk(shift(TODAY, -8), 25)],
    TODAY
  );
  assert.strictEqual(a.avgSession.text, '24m');
  assert.strictEqual(a.avgSession.deltaText, '\u22121m vs last week');
});

test('sessions from other timezones are bucketed by their own local date', () => {
  const a = computeAnalytics([mk(TODAY, 30), mk(shift(TODAY, 1), 30)], TODAY);
  assert.strictEqual(a.focusToday.text, '30m', 'tomorrow-in-Tokyo must not land in today');
});

console.log('\n' + passed + ' assertions passed');
