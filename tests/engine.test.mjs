import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  carryForwardPending,
  cleanSettings,
  dayLoad,
  dayStatus,
  detectConflicts,
  focusByTask,
  focusSeries,
  formatDuration,
  groupTasksByCategory,
  habitHasHistory,
  habitStreak,
  isIsoDate,
  makeBackup,
  monthGridDates,
  monthKey,
  niceHourScale,
  overdueTasks,
  parseBackup,
  planningStreak,
  reminderSummary,
  shiftMonth,
  sortTasksByPriority,
  tasksForDayView,
  timelineRange,
  weeklyReview,
} from '../src/app/domain/logic.ts';
import { escapeIcsText, foldIcsLine, makeReminderIcs, makeScheduleIcs } from '../src/app/domain/calendar-ics.ts';
import { CATEGORIES, DEFAULT_SETTINGS } from '../src/app/domain/models.ts';

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

test('categories include household, family, and children', () => {
  const ids = CATEGORIES.map(c => c.id);
  assert.ok(ids.includes('household'));
  assert.ok(ids.includes('family'));
  assert.ok(ids.includes('children'));
  assert.equal(ids.length, 8);
});

test('month grid covers Monday to Sunday across DST and year boundaries', () => {
  assert.equal(monthKey('2026-11-25'), '2026-11');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(isIsoDate('2026-02-29'), false);

  const nov = monthGridDates('2026-11');
  assert.equal(nov.length % 7, 0);
  assert.equal(nov[0], '2026-10-26');
  assert.equal(nov.at(-1), '2026-12-06');
});

test('tasks group by category and sort by priority (Top 3 -> High -> Normal -> Done) under each category', () => {
  const items = [
    task({ id: 'h-normal', category: 'household', priority: 'normal' }),
    task({ id: 'h-high', category: 'household', priority: 'high' }),
    task({ id: 'w-done', category: 'work', done: true, top3: true }),
    task({ id: 'w-normal', category: 'work', priority: 'normal' }),
    task({ id: 'w-high', category: 'work', priority: 'high' }),
    task({ id: 'w-top', category: 'work', top3: true }),
    task({ id: 'c-1', category: 'children', date: null }),
  ];

  const groups = groupTasksByCategory(items);
  assert.deepEqual(
    groups.map(g => g.category.id),
    ['work', 'household', 'children'],
  );
  assert.deepEqual(
    groups[0].tasks.map(t => t.id),
    ['w-top', 'w-high', 'w-normal', 'w-done'],
  );
  assert.deepEqual(
    groups[1].tasks.map(t => t.id),
    ['h-high', 'h-normal'],
  );
  assert.equal(sortTasksByPriority(items)[0].id, 'w-top');
});

test('undated tasks appear on Today view only and are never treated as overdue', () => {
  const items = [
    task({ id: 'undated', date: null, category: 'family' }),
    task({ id: 'today', date: '2026-11-25' }),
    task({ id: 'tomorrow', date: '2026-11-26' }),
    task({ id: 'yesterday', date: '2026-11-24' }),
  ];

  assert.deepEqual(
    tasksForDayView(items, '2026-11-25', '2026-11-25').map(t => t.id),
    ['undated', 'today'],
  );
  assert.deepEqual(
    tasksForDayView(items, '2026-11-26', '2026-11-25').map(t => t.id),
    ['tomorrow'],
  );
  assert.deepEqual(
    overdueTasks(items, '2026-11-25').map(t => t.id),
    ['yesterday'],
  );
});

test('automatic daily carry-forward moves pending dated tasks from earlier days to today and enforces Top 3 cap', () => {
  const list = [
    task({ id: 'today-1', date: '2026-11-25', top3: true }),
    task({ id: 'today-2', date: '2026-11-25', top3: true }),
    task({ id: 'old-1', date: '2026-11-23', top3: true, rolloverCount: 1 }),
    task({ id: 'old-2', date: '2026-11-24', top3: true, rolloverCount: 0 }),
    task({ id: 'old-done', date: '2026-11-24', done: true }),
    task({ id: 'undated', date: null }),
  ];

  const res = carryForwardPending(list, '2026-11-25');
  assert.equal(res.movedCount, 2);
  assert.equal(res.demotedTop3Count, 1);

  const moved1 = res.tasks.find(t => t.id === 'old-1');
  const moved2 = res.tasks.find(t => t.id === 'old-2');
  const undated = res.tasks.find(t => t.id === 'undated');
  assert.equal(moved1.date, '2026-11-25');
  assert.equal(moved1.top3, true);
  assert.equal(moved1.rolloverCount, 2);
  assert.equal(moved2.date, '2026-11-25');
  assert.equal(moved2.top3, false);
  assert.equal(moved2.rolloverCount, 1);
  assert.equal(undated.date, null, 'undated task stays undated');
});

test('conflict detection flags overlapping timed tasks and allows back-to-back blocks', () => {
  const conflicts = detectConflicts([
    task({ id: 'a', startTime: '09:00', durationMin: 30 }),
    task({ id: 'b', startTime: '09:30', durationMin: 30 }),
    task({ id: 'c', startTime: '10:00', durationMin: 60 }),
    task({ id: 'd', startTime: '10:30', durationMin: 30 }),
    task({ id: 'e', startTime: '10:15', durationMin: 30, done: true }),
  ]);
  assert.equal(conflicts.has('a'), false);
  assert.equal(conflicts.has('b'), false);
  assert.equal(conflicts.has('c'), true);
  assert.equal(conflicts.has('d'), true);
  assert.equal(conflicts.has('e'), false);
});

test('adaptive timeline range tightens around timed tasks and expands for early/late blocks', () => {
  assert.deepEqual(timelineRange([]), { startHour: 8, endHour: 18 });
  assert.deepEqual(
    timelineRange([task({ id: 'm', startTime: '09:00', durationMin: 60 })]),
    { startHour: 8, endHour: 12 },
  );
  assert.deepEqual(
    timelineRange([
      task({ id: 'early', startTime: '04:30', durationMin: 30 }),
      task({ id: 'late', startTime: '22:30', durationMin: 60 }),
    ]),
    { startHour: 3, endHour: 24 },
  );
});

test('focus totals are computed from DayRecord sessions and niceHourScale produces round hour ticks', () => {
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
      ],
    },
  };

  assert.deepEqual(focusByTask(days), { t1: 40 });
  const load = dayLoad([task({ id: 't1', durationMin: 90, done: true })], days['2026-11-25'], 60);
  assert.equal(load.overCapacity, true);
  assert.equal(formatDuration(90), '1h 30m');
  assert.equal(dayStatus([task({ done: true }), task({ done: false })]), 'partial');
  assert.deepEqual(niceHourScale(360), { step: 120, top: 360 });
  assert.deepEqual(niceHourScale(420), { step: 120, top: 480 });
});

test('habit streaks, planning streaks, weekly review completionPct, and 14-day series compute accurately', () => {
  const days = {
    '2026-11-23': { date: '2026-11-23', habits: { h1: true }, note: '', sessions: [{ id: 's1', taskId: 't1', kind: 'focus', minutes: 25, endedAt: '2026-11-23T10:00:00Z' }] },
    '2026-11-24': { date: '2026-11-24', habits: { h1: true }, note: '', sessions: [] },
    '2026-11-25': { date: '2026-11-25', habits: { h1: true }, note: '', sessions: [] },
  };
  assert.equal(habitStreak(days, 'h1', '2026-11-25'), 3);
  assert.equal(habitHasHistory(days, 'h1'), true);

  const tasks = [
    task({ id: 't1', date: '2026-11-23', durationMin: 60, done: true, category: 'work' }),
    task({ id: 't2', date: '2026-11-24', durationMin: 30, done: true, category: 'family' }),
    task({ id: 't3', date: '2026-11-25', durationMin: 45, done: false, category: 'work', top3: true }),
  ];
  assert.equal(planningStreak(tasks, '2026-11-25'), 2);

  const review = weeklyReview(tasks, days, '2026-11-25', [{ id: 'h1', name: 'Read 20m' }]);
  assert.equal(review.completionPct, 67);
  const workCat = review.categories.find(c => c.id === 'work');
  assert.equal(workCat.completionPct, 50);

  const series = focusSeries(days, tasks, '2026-11-25', 14);
  assert.equal(series.length, 14);
  assert.equal(reminderSummary(tasks, '2026-11-25').allTop3Done, false);
});

test('ICS escaping, 75-octet line folding, and schedule/reminder exports follow RFC 5545', () => {
  assert.equal(escapeIcsText('A, B; C\\D\nLine 2'), 'A\\, B\\; C\\\\D\\nLine 2');
  const folded = foldIcsLine(`SUMMARY:${'A'.repeat(120)}`);
  for (const part of folded.split('\r\n')) {
    assert.ok(new TextEncoder().encode(part).length <= 75);
  }

  const sched = makeScheduleIcs(
    [
      task({ id: 'x1', title: 'Review Q4; budget, deck', date: '2026-11-25', startTime: '09:30', durationMin: 45, top3: true }),
      task({ id: 'x2', title: 'Undated task', date: null, startTime: null }),
    ],
    '2026-11-25',
  );
  assert.match(sched, /DTSTART:20261125T093000/);
  assert.match(sched, /SUMMARY:★ Review Q4\\; budget\\, deck/);
  assert.doesNotMatch(sched, /Undated task/);
  assert.match(makeReminderIcs(DEFAULT_SETTINGS, '2026-11-25', []), /BEGIN:VCALENDAR/);
});

test('backups round-trip undated & dated tasks cleanly, refuse bad files, and sanitize untrusted input', () => {
  const tasks = [
    task({ id: 't1', title: 'Ship v1', startTime: '10:00', top3: true, priority: 'high', category: 'work' }),
    task({ id: 't2', title: 'Organize garage', date: null, category: 'household' }),
  ];
  const days = [{ date: '2026-11-25', habits: { h1: true }, note: 'Solid day', sessions: [{ id: 's1', taskId: 't1', kind: 'focus', minutes: 25, endedAt: '2026-11-25T10:30:00Z' }] }];
  const plans = [{ id: 'W:2026-11-23', goals: [{ id: 'g1', title: 'Finish planner', done: false }], reflection: { wins: 'Focused', slipped: '', nextFocus: 'Ship' } }];
  const settings = cleanSettings({ ...DEFAULT_SETTINGS, dailyCapacityMin: 420, habits: [{ id: 'h1', name: 'Walk' }] });

  const out = parseBackup(makeBackup(tasks, days, plans, settings, '2026-11-25T12:00:00Z'));
  assert.deepEqual(out.tasks, tasks);
  assert.deepEqual(out.days, days);
  assert.deepEqual(out.plans, plans);
  assert.deepEqual(out.settings, settings);

  assert.throws(() => parseBackup('not json'), /not a Daily Planner backup/);
  assert.throws(() => parseBackup('{"app":"workout-tracker","tasks":[]}'), /not a Daily Planner backup/);

  const dirty = JSON.stringify({
    app: 'daily-planner',
    tasks: [
      { id: 'bad', title: 'Bad date', date: '2026-02-30' },
      { id: 'u1', title: 'Undated ok', date: null, category: 'children' },
      { id: 'k1', title: 'One', date: '2026-11-25', startTime: '99:99', durationMin: 9999, top3: true },
      { id: 'k2', title: 'Two', date: '2026-11-25', top3: true },
      { id: 'k3', title: 'Three', date: '2026-11-25', top3: true },
      { id: 'k4', title: 'Four', date: '2026-11-25', top3: true },
    ],
    days: [{ date: '2026-11-25', habits: { h1: true, h2: 'yes' }, sessions: [{ id: 's', kind: 'focus', minutes: 0 }] }],
    plans: [{ id: 'M:2026-11', goals: [{ id: 'g1', title: 'Valid', done: true }] }],
    settings: { dailyCapacityMin: 5, focusMinutes: 99, habits: [{ id: 'h2', name: 'Read' }] },
  });
  const sanitized = parseBackup(dirty);
  assert.equal(sanitized.tasks.length, 5);
  assert.equal(sanitized.tasks[0].date, null);
  assert.equal(sanitized.tasks[0].category, 'children');
  assert.equal(sanitized.tasks[4].top3, false);
  assert.equal(sanitized.days[0].sessions.length, 0);
  assert.equal(addDays('2026-11-25', 1), '2026-11-26');
});
