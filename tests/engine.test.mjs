import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  cleanSettings,
  dayLoad,
  dayPartOf,
  dayStatus,
  detectConflicts,
  focusByTask,
  focusSeries,
  formatDuration,
  habitHasHistory,
  habitStreak,
  isIsoDate,
  makeBackup,
  monthGridDates,
  monthKey,
  overdueTasks,
  parseBackup,
  planningStreak,
  reminderSummary,
  rolloverTo,
  shiftMonth,
  sortTasksForDay,
  timelineRange,
  weeklyReview,
} from '../src/app/domain/logic.ts';
import { escapeIcsText, foldIcsLine, makeReminderIcs, makeScheduleIcs } from '../src/app/domain/calendar-ics.ts';
import { DEFAULT_SETTINGS } from '../src/app/domain/models.ts';

const task = (overrides = {}) => ({
  id: 't1',
  title: 'Sample task',
  date: '2026-11-25',
  startTime: null,
  durationMin: 30,
  priority: 'normal',
  top3: false,
  category: 'work',
  subtasks: [],
  notes: '',
  done: false,
  completedAt: null,
  rolloverCount: 0,
  order: 0,
  createdAt: '2026-11-25T08:00:00.000Z',
  ...overrides,
});

test('month grid covers Monday to Sunday across DST and year boundaries', () => {
  assert.equal(monthKey('2026-11-25'), '2026-11');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-29'), false);

  // November 2026 starts on Sunday (2026-11-01, US DST ends) and ends Monday (2026-11-30).
  const nov = monthGridDates('2026-11');
  assert.equal(nov.length % 7, 0);
  assert.equal(nov[0], '2026-10-26'); // Monday before Nov 1
  assert.equal(nov.at(-1), '2026-12-06'); // Sunday after Nov 30
  assert.equal(nov.includes('2026-11-01'), true);
  assert.equal(nov.includes('2026-11-02'), true);

  // December 2026 crosses into January 2027 cleanly.
  const dec = monthGridDates('2026-12');
  assert.equal(dec[0], '2026-11-30');
  assert.equal(dec.at(-1), '2027-01-03');
});

test('day-part grouping and sort order prioritize Top 3, timed chronology, High, and done last', () => {
  assert.equal(dayPartOf('08:30'), 'morning');
  assert.equal(dayPartOf('12:00'), 'afternoon');
  assert.equal(dayPartOf('17:00'), 'evening');
  assert.equal(dayPartOf(null), 'anytime');

  const sorted = sortTasksForDay([
    task({ id: 'done', done: true, top3: true }),
    task({ id: 'normal', priority: 'normal', order: 1 }),
    task({ id: 'high', priority: 'high', order: 2 }),
    task({ id: 'late', startTime: '14:00' }),
    task({ id: 'early', startTime: '09:00' }),
    task({ id: 'top', top3: true, priority: 'high' }),
  ]);
  assert.deepEqual(sorted.map(t => t.id), ['top', 'early', 'late', 'high', 'normal', 'done']);
});

test('conflict detection flags overlapping timed tasks and allows back-to-back blocks', () => {
  const conflicts = detectConflicts([
    task({ id: 'a', startTime: '09:00', durationMin: 30 }),
    task({ id: 'b', startTime: '09:30', durationMin: 30 }), // back-to-back, no conflict
    task({ id: 'c', startTime: '10:00', durationMin: 60 }),
    task({ id: 'd', startTime: '10:30', durationMin: 30 }), // overlaps c
    task({ id: 'e', startTime: '10:15', durationMin: 30, done: true }), // done tasks ignored
  ]);
  assert.equal(conflicts.has('a'), false);
  assert.equal(conflicts.has('b'), false);
  assert.equal(conflicts.has('c'), true);
  assert.equal(conflicts.has('d'), true);
  assert.equal(conflicts.has('e'), false);
});

test('timeline range defaults to 06:00–22:00 and expands for early or late tasks', () => {
  assert.deepEqual(timelineRange([]), { startHour: 6, endHour: 22 });
  assert.deepEqual(
    timelineRange([
      task({ id: 'early', startTime: '04:30', durationMin: 30 }),
      task({ id: 'late', startTime: '22:30', durationMin: 60 }),
    ]),
    { startHour: 4, endHour: 24 },
  );
});

test('rollover increments rolloverCount, enforces Top 3 cap, and preserves undo snapshot', () => {
  const list = [
    task({ id: 'today-1', date: '2026-11-25', top3: true }),
    task({ id: 'today-2', date: '2026-11-25', top3: true }),
    task({ id: 'old-1', date: '2026-11-23', top3: true, rolloverCount: 1 }),
    task({ id: 'old-2', date: '2026-11-24', top3: true, rolloverCount: 0 }),
    task({ id: 'old-done', date: '2026-11-24', done: true }),
  ];

  const overdue = overdueTasks(list, '2026-11-25');
  assert.deepEqual(overdue.map(t => t.id), ['old-1', 'old-2']);

  const res = rolloverTo(list, overdue.map(t => t.id), '2026-11-25');
  assert.equal(res.movedCount, 2);
  assert.equal(res.demotedTop3Count, 1);
  assert.equal(res.previous.length, 2);

  const moved1 = res.tasks.find(t => t.id === 'old-1');
  const moved2 = res.tasks.find(t => t.id === 'old-2');
  assert.equal(moved1.date, '2026-11-25');
  assert.equal(moved1.top3, true);
  assert.equal(moved1.rolloverCount, 2);
  assert.equal(moved2.date, '2026-11-25');
  assert.equal(moved2.top3, false, '4th Top 3 task is demoted');
  assert.equal(moved2.rolloverCount, 1);
});

test('focus totals are computed from DayRecord sessions and exclude breaks', () => {
  const days = {
    '2026-11-24': {
      date: '2026-11-24',
      habits: {},
      note: '',
      sessions: [
        { id: 's1', taskId: 't1', kind: 'focus', minutes: 25, endedAt: '2026-11-24T10:00:00Z' },
        { id: 's2', taskId: 't1', kind: 'break', minutes: 5, endedAt: '2026-11-24T10:05:00Z' },
      ],
    },
    '2026-11-25': {
      date: '2026-11-25',
      habits: {},
      note: '',
      sessions: [
        { id: 's3', taskId: 't1', kind: 'focus', minutes: 15, endedAt: '2026-11-25T11:00:00Z' },
        { id: 's4', taskId: 't2', kind: 'focus', minutes: 20, endedAt: '2026-11-25T12:00:00Z' },
      ],
    },
  };

  assert.deepEqual(focusByTask(days), { t1: 40, t2: 20 });
  const load = dayLoad([task({ id: 't1', durationMin: 60, done: true }), task({ id: 't2', durationMin: 30 })], days['2026-11-25'], 60);
  assert.equal(load.plannedMin, 90);
  assert.equal(load.focusedMin, 35);
  assert.equal(load.overCapacity, true);
  assert.equal(formatDuration(90), '1h 30m');
  assert.equal(dayStatus([task({ done: true }), task({ done: false })]), 'partial');
});

test('habit streaks, planning streaks, weekly review, and 14-day series compute accurately', () => {
  const days = {
    '2026-11-23': { date: '2026-11-23', habits: { h1: true }, note: '', sessions: [{ id: 's1', taskId: 't1', kind: 'focus', minutes: 25, endedAt: '2026-11-23T10:00:00Z' }] },
    '2026-11-24': { date: '2026-11-24', habits: { h1: true }, note: '', sessions: [] },
    '2026-11-25': { date: '2026-11-25', habits: { h1: true }, note: '', sessions: [] },
  };
  assert.equal(habitStreak(days, 'h1', '2026-11-25'), 3);
  assert.equal(habitStreak(days, 'h1', '2026-11-26'), 3, 'yesterday keeps streak alive until end of today');
  assert.equal(habitStreak(days, 'h1', '2026-11-27'), 0);
  assert.equal(habitHasHistory(days, 'h1'), true);
  assert.equal(habitHasHistory(days, 'h2'), false);

  const tasks = [
    task({ id: 't1', date: '2026-11-23', durationMin: 60, done: true, category: 'work' }),
    task({ id: 't2', date: '2026-11-24', durationMin: 30, done: true, category: 'health' }),
    task({ id: 't3', date: '2026-11-25', durationMin: 45, done: false, category: 'work', top3: true }),
  ];
  assert.equal(planningStreak(tasks, '2026-11-25'), 2);

  const review = weeklyReview(tasks, days, '2026-11-25', [{ id: 'h1', name: 'Read 20m' }]);
  assert.equal(review.monday, '2026-11-23');
  assert.equal(review.totalTasks, 3);
  assert.equal(review.doneTasks, 2);
  assert.equal(review.completionPct, 67);
  assert.equal(review.plannedMin, 135);
  assert.equal(review.focusedMin, 25);
  assert.equal(review.unfinished.length, 1);
  assert.equal(review.habitRows[0].doneCount, 3);

  const series = focusSeries(days, tasks, '2026-11-25', 14);
  assert.equal(series.length, 14);
  assert.equal(series.at(-1).date, '2026-11-25');
  assert.equal(series.find(p => p.date === '2026-11-23').focusedMin, 25);

  const rem = reminderSummary(tasks, '2026-11-25');
  assert.equal(rem.allTop3Done, false);
  assert.match(rem.body, /Sample task/);
});

test('ICS escaping, 75-octet line folding, and schedule/reminder exports follow RFC 5545', () => {
  assert.equal(escapeIcsText('A, B; C\\D\nLine 2'), 'A\\, B\\; C\\\\D\\nLine 2');
  const longLine = `SUMMARY:${'A'.repeat(120)}`;
  const folded = foldIcsLine(longLine);
  for (const part of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(part).length <= 75, `line exceeds 75 bytes: ${part.length}`);
  }

  const sched = makeScheduleIcs(
    [
      task({ id: 'x1', title: 'Review Q4; budget, deck', date: '2026-11-25', startTime: '09:30', durationMin: 45, top3: true }),
      task({ id: 'x2', title: 'Past task', date: '2026-11-20', startTime: '09:00', durationMin: 30 }),
      task({ id: 'x3', title: 'Untimed task', date: '2026-11-25', startTime: null }),
    ],
    '2026-11-25',
  );
  assert.match(sched, /DTSTART:20261125T093000/);
  assert.match(sched, /DURATION:PT45M/);
  assert.match(sched, /SUMMARY:★ Review Q4\\; budget\\, deck/);
  assert.doesNotMatch(sched, /Past task/);
  assert.doesNotMatch(sched, /Untimed task/);

  const remIcs = makeReminderIcs(DEFAULT_SETTINGS, '2026-11-25', []);
  assert.match(remIcs, /BEGIN:VCALENDAR/);
  assert.match(remIcs, /PRODID:-\/\/Daily Planner\/\/EN/);
});

test('backups round-trip cleanly, refuse bad files, and sanitize untrusted input', () => {
  const tasks = [task({ id: 't1', title: 'Ship v1', startTime: '10:00', top3: true, priority: 'high' })];
  const days = [{ date: '2026-11-25', habits: { h1: true }, note: 'Solid day', sessions: [{ id: 's1', taskId: 't1', kind: 'focus', minutes: 25, endedAt: '2026-11-25T10:30:00Z' }] }];
  const plans = [{ id: 'W:2026-11-23', goals: [{ id: 'g1', title: 'Finish planner', done: false }], reflection: { wins: 'Focused', slipped: '', nextFocus: 'Ship' } }];
  const settings = cleanSettings({ ...DEFAULT_SETTINGS, dailyCapacityMin: 420, habits: [{ id: 'h1', name: 'Walk' }] });

  const json = makeBackup(tasks, days, plans, settings, '2026-11-25T12:00:00Z');
  const out = parseBackup(json);
  assert.deepEqual(out.tasks, tasks);
  assert.deepEqual(out.days, days);
  assert.deepEqual(out.plans, plans);
  assert.deepEqual(out.settings, settings);

  assert.throws(() => parseBackup('not json'), /not a Daily Planner backup/);
  assert.throws(() => parseBackup('{"app":"workout-tracker","tasks":[]}'), /not a Daily Planner backup/);
  assert.throws(() => parseBackup('{"app":"daily-planner"}'), /not a Daily Planner backup/);

  // Untrusted payload: bad dates, invalid times, >3 Top 3 tasks, unknown keys, out-of-range settings.
  const dirty = JSON.stringify({
    app: 'daily-planner',
    tasks: [
      { id: 'bad', title: 'Bad date', date: '2026-02-30' },
      { id: 'k1', title: 'One', date: '2026-11-25', startTime: '99:99', durationMin: 9999, top3: true, evil: 1 },
      { id: 'k2', title: 'Two', date: '2026-11-25', top3: true },
      { id: 'k3', title: 'Three', date: '2026-11-25', top3: true },
      { id: 'k4', title: 'Four', date: '2026-11-25', top3: true },
    ],
    days: [{ date: '2026-11-25', habits: { h1: true, h2: 'yes' }, sessions: [{ id: 's', kind: 'focus', minutes: 0 }] }],
    plans: [{ id: 'X:bad', goals: [{ id: 'g', title: 'Nope', done: false }] }, { id: 'M:2026-11', goals: [{ id: 'g1', title: 'Valid', done: true }, { id: 'g2', title: '  ', done: false }] }],
    settings: { dailyCapacityMin: 5, focusMinutes: 99, habits: [{ id: 'h1', name: '' }, { id: 'h2', name: 'Read' }] },
  });
  const sanitized = parseBackup(dirty);
  assert.equal(sanitized.tasks.length, 4);
  assert.equal(sanitized.tasks[0].startTime, null);
  assert.equal(sanitized.tasks[0].durationMin, 480);
  assert.equal(sanitized.tasks[3].top3, false, 'Top 3 capped at 3 per date');
  assert.equal(sanitized.days[0].habits.h2, undefined);
  assert.equal(sanitized.days[0].sessions.length, 0);
  assert.equal(sanitized.plans.length, 1);
  assert.equal(sanitized.plans[0].goals.length, 1);
  assert.equal(sanitized.settings.dailyCapacityMin, 240);
  assert.equal(sanitized.settings.focusMinutes, 25);
  assert.deepEqual(sanitized.settings.habits, [{ id: 'h2', name: 'Read' }]);
  assert.equal(addDays('2026-11-25', 1), '2026-11-26');
});
