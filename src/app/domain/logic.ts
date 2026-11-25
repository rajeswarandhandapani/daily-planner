// Pure TypeScript planning engine: calendar math, category+priority grouping,
// conflict detection, automatic daily carry-forward, focus totals, habit streaks,
// weekly review, and strict backup validation. Zero DOM dependencies.

import {
  addDays,
  daysBetween,
  fromIso,
  localToday,
  mondayOf,
  nextMonday,
  toIso,
  weekDates,
  weekdayOf,
} from '../kit/dates';
import { reminderDue } from '../kit/ics';
import {
  type BackupData,
  BREAK_PRESETS,
  CATEGORIES,
  CATEGORY_IDS,
  type CategoryId,
  type CategoryMeta,
  type DayRecord,
  DEFAULT_REMINDER,
  DEFAULT_SETTINGS,
  FOCUS_PRESETS,
  type FocusSession,
  type GoalItem,
  type HabitDef,
  MAX_DURATION_MIN,
  MAX_GOALS,
  MAX_HABITS,
  MAX_NOTES_LEN,
  MAX_SUBTASKS,
  MAX_TITLE_LEN,
  MAX_TOP3,
  MIN_DURATION_MIN,
  type PeriodPlan,
  type PlannerSettings,
  type Priority,
  type Subtask,
  type TaskItem,
  type WeeklyReflection,
} from './models';

export {
  addDays,
  daysBetween,
  fromIso,
  localToday,
  mondayOf,
  nextMonday,
  reminderDue,
  toIso,
  weekDates,
  weekdayOf,
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLAN_ID_RE = /^(?:W:\d{4}-\d{2}-\d{2}|M:\d{4}-\d{2})$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const d = fromIso(value);
  return !Number.isNaN(d.getTime()) && toIso(d) === value;
}

export function isTime(value: unknown): value is string {
  return typeof value === 'string' && TIME_RE.test(value);
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMin: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(totalMin)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Returns 35 or 42 Monday-to-Sunday ISO dates covering the entire month grid. */
export function monthGridDates(ym: string): string[] {
  const [y, m] = ym.split('-').map(Number);
  const firstIso = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDayDate = new Date(y, m, 0, 12);
  const lastIso = toIso(lastDayDate);
  const gridStart = mondayOf(firstIso);
  const lastWd = weekdayOf(lastIso); // 0=Sun..6=Sat
  const trailing = lastWd === 0 ? 0 : 7 - lastWd;
  const gridEnd = addDays(lastIso, trailing);
  const count = daysBetween(gridStart, gridEnd) + 1;
  return Array.from({ length: count }, (_, i) => addDays(gridStart, i));
}

export function weekPlanId(mondayIso: string): string {
  return `W:${mondayOf(mondayIso)}`;
}

export function monthPlanId(ym: string): string {
  return `M:${ym}`;
}

/**
 * Sorts tasks by priority under a category or day:
 * Undone first -> Top 3 -> High priority -> Normal -> timed chronology -> order -> createdAt.
 */
export function sortTasksByPriority(tasks: readonly TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.top3 !== b.top3) return a.top3 ? -1 : 1;
    if (a.priority !== b.priority) return a.priority === 'high' ? -1 : 1;
    const aTimed = a.startTime !== null;
    const bTimed = b.startTime !== null;
    if (aTimed !== bTimed) return aTimed ? -1 : 1;
    if (a.startTime && b.startTime && a.startTime !== b.startTime) {
      return a.startTime < b.startTime ? -1 : 1;
    }
    if (a.order !== b.order) return a.order - b.order;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

export interface CategoryGroup {
  category: CategoryMeta;
  tasks: TaskItem[];
  doneCount: number;
  totalCount: number;
}

/** Groups tasks by Category (in CATEGORIES order) and sorts by Priority under each category. */
export function groupTasksByCategory(tasks: readonly TaskItem[]): CategoryGroup[] {
  const byCat = new Map<CategoryId, TaskItem[]>();
  for (const t of tasks) {
    const list = byCat.get(t.category) ?? [];
    list.push(t);
    byCat.set(t.category, list);
  }
  const groups: CategoryGroup[] = [];
  for (const cat of CATEGORIES) {
    const raw = byCat.get(cat.id);
    if (!raw || raw.length === 0) continue;
    const sorted = sortTasksByPriority(raw);
    groups.push({
      category: cat,
      tasks: sorted,
      doneCount: sorted.filter(t => t.done).length,
      totalCount: sorted.length,
    });
  }
  return groups;
}

/**
 * Returns tasks visible on a date in Today view:
 * - On `todayIso`: dated tasks for `todayIso` + undated (`date === null`) tasks.
 * - On any other date: only tasks dated to `selectedIso`.
 */
export function tasksForDayView(
  allTasks: readonly TaskItem[],
  selectedIso: string,
  todayIso: string,
): TaskItem[] {
  const includeUndated = selectedIso === todayIso;
  return allTasks.filter(t => t.date === selectedIso || (includeUndated && t.date === null));
}

export interface TimelineRange {
  startHour: number;
  endHour: number;
}

/**
 * Adaptive timeline range: when timed tasks exist, spans from 1 hour before earliest
 * to 1 hour after latest (clamped 0–24); when none exist, defaults to 08:00–18:00.
 */
export function timelineRange(tasks: readonly TaskItem[]): TimelineRange {
  const timed = tasks.filter(t => t.startTime !== null && isTime(t.startTime));
  if (timed.length === 0) return { startHour: 8, endHour: 18 };
  let minHour = 23;
  let maxHour = 1;
  for (const t of timed) {
    const startMin = timeToMinutes(t.startTime as string);
    const endMin = startMin + Math.max(MIN_DURATION_MIN, t.durationMin);
    minHour = Math.min(minHour, Math.floor(startMin / 60));
    maxHour = Math.max(maxHour, Math.min(24, Math.ceil(endMin / 60)));
  }
  return {
    startHour: Math.max(0, minHour - 1),
    endHour: Math.min(24, Math.max(minHour + 3, maxHour + 1)),
  };
}

/**
 * Returns IDs of timed, incomplete tasks whose [start, start + durationMin)
 * strictly overlaps another timed, incomplete task on the same day.
 * Back-to-back blocks (e.g. 09:00–09:30 and 09:30–10:00) do not conflict.
 */
export function detectConflicts(tasks: readonly TaskItem[]): Set<string> {
  const timed = tasks
    .filter(t => !t.done && t.startTime !== null && isTime(t.startTime))
    .map(t => {
      const start = timeToMinutes(t.startTime as string);
      const end = start + Math.max(MIN_DURATION_MIN, t.durationMin);
      return { id: t.id, start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const conflicts = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j].start >= timed[i].end) break;
      conflicts.add(timed[i].id);
      conflicts.add(timed[j].id);
    }
  }
  return conflicts;
}

/** Computes total focused minutes per task solely from DayRecord focus sessions (breaks excluded). */
export function focusByTask(days: Record<string, DayRecord>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const day of Object.values(days)) {
    for (const s of day.sessions ?? []) {
      if (s.kind !== 'focus' || !s.taskId || s.minutes <= 0) continue;
      totals[s.taskId] = (totals[s.taskId] ?? 0) + s.minutes;
    }
  }
  return totals;
}

export function dayFocusMinutes(day: DayRecord | undefined): number {
  if (!day?.sessions?.length) return 0;
  let sum = 0;
  for (const s of day.sessions) {
    if (s.kind === 'focus' && s.minutes > 0) sum += s.minutes;
  }
  return sum;
}

export interface DayLoad {
  totalCount: number;
  doneCount: number;
  plannedMin: number;
  doneMin: number;
  focusedMin: number;
  ratio: number;
  overCapacity: boolean;
}

export function dayLoad(
  tasksForDay: readonly TaskItem[],
  day: DayRecord | undefined,
  capacityMin: number,
): DayLoad {
  let doneCount = 0;
  let plannedMin = 0;
  let doneMin = 0;
  for (const t of tasksForDay) {
    plannedMin += t.durationMin;
    if (t.done) {
      doneCount += 1;
      doneMin += t.durationMin;
    }
  }
  const focusedMin = dayFocusMinutes(day);
  const totalCount = tasksForDay.length;
  const ratio = totalCount > 0 ? doneCount / totalCount : 0;
  return {
    totalCount,
    doneCount,
    plannedMin,
    doneMin,
    focusedMin,
    ratio,
    overCapacity: plannedMin > capacityMin,
  };
}

export type DayStatus = 'done' | 'partial' | 'planned' | 'open';

export function dayStatus(tasksForDay: readonly TaskItem[]): DayStatus {
  if (tasksForDay.length === 0) return 'open';
  const done = tasksForDay.filter(t => t.done).length;
  if (done === tasksForDay.length) return 'done';
  if (done > 0) return 'partial';
  return 'planned';
}

export function top3CountOnScope(
  tasks: readonly TaskItem[],
  date: string | null,
  excludeId?: string,
): number {
  let count = 0;
  for (const t of tasks) {
    if (t.date === date && t.top3 && t.id !== excludeId) count += 1;
  }
  return count;
}

/** Pending dated tasks strictly before `todayIso` (undated tasks are not overdue). */
export function overdueTasks(tasks: readonly TaskItem[], todayIso: string): TaskItem[] {
  return tasks
    .filter((t): t is TaskItem & { date: string } => !t.done && t.date !== null && t.date < todayIso)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.top3 !== b.top3) return a.top3 ? -1 : 1;
      if (a.startTime && b.startTime && a.startTime !== b.startTime) {
        return a.startTime < b.startTime ? -1 : 1;
      }
      return a.order - b.order;
    });
}

export interface RolloverResult {
  tasks: TaskItem[];
  movedCount: number;
  demotedTop3Count: number;
  previous: TaskItem[];
}

export function rolloverTo(
  allTasks: readonly TaskItem[],
  ids: readonly string[],
  targetIso: string,
): RolloverResult {
  const idSet = new Set(ids);
  const previous: TaskItem[] = [];
  let targetTop3 = top3CountOnScope(allTasks, targetIso);
  let movedCount = 0;
  let demotedTop3Count = 0;

  const updated = allTasks.map(t => {
    if (!idSet.has(t.id) || t.date === targetIso) return t;
    previous.push({ ...t, subtasks: t.subtasks.map(s => ({ ...s })) });
    movedCount += 1;
    let nextTop3 = t.top3;
    if (nextTop3) {
      if (targetTop3 < MAX_TOP3) {
        targetTop3 += 1;
      } else {
        nextTop3 = false;
        demotedTop3Count += 1;
      }
    }
    return {
      ...t,
      date: targetIso,
      top3: nextTop3,
      rolloverCount: t.rolloverCount + 1,
    };
  });

  return { tasks: updated, movedCount, demotedTop3Count, previous };
}

/** Automatically carries all pending dated tasks from previous days forward to `todayIso`. */
export function carryForwardPending(allTasks: readonly TaskItem[], todayIso: string): RolloverResult {
  const pending = overdueTasks(allTasks, todayIso);
  if (pending.length === 0) {
    return { tasks: [...allTasks], movedCount: 0, demotedTop3Count: 0, previous: [] };
  }
  return rolloverTo(
    allTasks,
    pending.map(t => t.id),
    todayIso,
  );
}

export function habitStreak(
  days: Record<string, DayRecord>,
  habitId: string,
  todayIso: string,
): number {
  let cursor = todayIso;
  if (!days[cursor]?.habits?.[habitId]) {
    cursor = addDays(todayIso, -1);
  }
  let streak = 0;
  while (days[cursor]?.habits?.[habitId]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function habitHasHistory(days: Record<string, DayRecord>, habitId: string): boolean {
  for (const day of Object.values(days)) {
    if (day.habits?.[habitId]) return true;
  }
  return false;
}

export function planningStreak(tasks: readonly TaskItem[], todayIso: string): number {
  const completedDates = new Set<string>();
  for (const t of tasks) {
    if (!t.done) continue;
    const d = t.date ?? (t.completedAt ? t.completedAt.slice(0, 10) : null);
    if (d && isIsoDate(d)) completedDates.add(d);
  }
  let cursor = todayIso;
  if (!completedDates.has(cursor)) {
    cursor = addDays(todayIso, -1);
  }
  let streak = 0;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export interface CategoryBreakdown {
  id: CategoryId;
  label: string;
  colorVar: string;
  totalTasks: number;
  doneTasks: number;
  completionPct: number;
  plannedMin: number;
  focusedMin: number;
}

export interface HabitWeekRow {
  habit: HabitDef;
  checks: boolean[];
  doneCount: number;
}

export interface WeeklyReviewData {
  monday: string;
  dates: string[];
  totalTasks: number;
  doneTasks: number;
  completionPct: number;
  plannedMin: number;
  focusedMin: number;
  categories: CategoryBreakdown[];
  unfinished: TaskItem[];
  habitRows: HabitWeekRow[];
  habitPct: number;
}

export function weeklyReview(
  tasks: readonly TaskItem[],
  days: Record<string, DayRecord>,
  mondayIso: string,
  habits: readonly HabitDef[],
): WeeklyReviewData {
  const monday = mondayOf(mondayIso);
  const dates = weekDates(monday);
  const dateSet = new Set(dates);
  const weekTasks = tasks.filter(t => t.date !== null && dateSet.has(t.date));
  const doneTasks = weekTasks.filter(t => t.done).length;
  const totalTasks = weekTasks.length;
  const completionPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  let plannedMin = 0;
  for (const t of weekTasks) plannedMin += t.durationMin;

  let focusedMin = 0;
  const taskFocusInWeek: Record<string, number> = {};
  for (const d of dates) {
    const rec = days[d];
    if (!rec?.sessions) continue;
    for (const s of rec.sessions) {
      if (s.kind !== 'focus' || s.minutes <= 0) continue;
      focusedMin += s.minutes;
      if (s.taskId) {
        taskFocusInWeek[s.taskId] = (taskFocusInWeek[s.taskId] ?? 0) + s.minutes;
      }
    }
  }

  const catMap = new Map<CategoryId, CategoryBreakdown>();
  for (const c of CATEGORIES) {
    catMap.set(c.id, {
      id: c.id,
      label: c.label,
      colorVar: c.colorVar,
      totalTasks: 0,
      doneTasks: 0,
      completionPct: 0,
      plannedMin: 0,
      focusedMin: 0,
    });
  }
  for (const t of weekTasks) {
    const row = catMap.get(t.category);
    if (!row) continue;
    row.totalTasks += 1;
    if (t.done) row.doneTasks += 1;
    row.plannedMin += t.durationMin;
    row.focusedMin += taskFocusInWeek[t.id] ?? 0;
  }
  const categories = [...catMap.values()]
    .filter(c => c.totalTasks > 0 || c.focusedMin > 0)
    .map(c => ({
      ...c,
      completionPct: c.totalTasks > 0 ? Math.round((c.doneTasks / c.totalTasks) * 100) : 0,
    }))
    .sort((a, b) => b.plannedMin - a.plannedMin || b.totalTasks - a.totalTasks);

  const unfinished = weekTasks
    .filter(t => !t.done)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.top3 === b.top3 ? 0 : a.top3 ? -1 : 1));

  const activeHabits = habits.filter(h => !h.archived);
  let habitDoneTotal = 0;
  const habitRows: HabitWeekRow[] = activeHabits.map(habit => {
    const checks = dates.map(d => Boolean(days[d]?.habits?.[habit.id]));
    const doneCount = checks.filter(Boolean).length;
    habitDoneTotal += doneCount;
    return { habit, checks, doneCount };
  });
  const habitSlots = activeHabits.length * 7;
  const habitPct = habitSlots > 0 ? Math.round((habitDoneTotal / habitSlots) * 100) : 0;

  return {
    monday,
    dates,
    totalTasks,
    doneTasks,
    completionPct,
    plannedMin,
    focusedMin,
    categories,
    unfinished,
    habitRows,
    habitPct,
  };
}

export interface FocusDayPoint {
  date: string;
  focusedMin: number;
  plannedMin: number;
  doneCount: number;
}

export function focusSeries(
  days: Record<string, DayRecord>,
  tasks: readonly TaskItem[],
  endIso: string,
  numDays = 14,
): FocusDayPoint[] {
  const count = Math.max(1, Math.round(numDays));
  const startIso = addDays(endIso, -(count - 1));
  const dates = Array.from({ length: count }, (_, i) => addDays(startIso, i));
  const byDate = new Map<string, { plannedMin: number; doneCount: number }>();
  for (const d of dates) byDate.set(d, { plannedMin: 0, doneCount: 0 });

  for (const t of tasks) {
    if (!t.date) continue;
    const slot = byDate.get(t.date);
    if (!slot) continue;
    slot.plannedMin += t.durationMin;
    if (t.done) slot.doneCount += 1;
  }

  return dates.map(date => {
    const slot = byDate.get(date)!;
    return {
      date,
      focusedMin: dayFocusMinutes(days[date]),
      plannedMin: slot.plannedMin,
      doneCount: slot.doneCount,
    };
  });
}

/** Computes clean hour-aligned scale steps (e.g. 60m, 120m, 180m) for the focus/planned SVG chart. */
export function niceHourScale(peakMin: number): { step: number; top: number } {
  const target = Math.max(120, peakMin);
  const candidates = [60, 120, 180, 240];
  const step = candidates.find(s => Math.ceil(target / s) <= 4) ?? 240;
  const top = Math.ceil(target / step) * step;
  return { step, top };
}

export interface ReminderSummary {
  title: string;
  body: string;
  allTop3Done: boolean;
}

export function reminderSummary(tasks: readonly TaskItem[], todayIso: string): ReminderSummary {
  const todays = sortTasksByPriority(tasksForDayView(tasks, todayIso, todayIso));
  const top3 = todays.filter(t => t.top3);
  const allTop3Done = top3.length > 0 && top3.every(t => t.done);
  const remaining = todays.filter(t => !t.done);

  if (todays.length === 0) {
    return {
      title: 'Plan your day',
      body: 'Pick your Top 3 priorities and organize today.',
      allTop3Done: false,
    };
  }
  const topNames = top3
    .filter(t => !t.done)
    .map(t => t.title)
    .slice(0, 3);
  const countText = `${remaining.length} ${remaining.length === 1 ? 'task' : 'tasks'} left`;
  return {
    title: topNames.length > 0 ? `Plan your day: ${countText}` : `Today: ${countText}`,
    body: topNames.length > 0 ? `Top 3: ${topNames.join(' · ')}` : 'Open Daily Planner to review today.',
    allTop3Done,
  };
}

export function isEmptyDayRecord(day: DayRecord | undefined): boolean {
  if (!day) return true;
  const hasHabits = Object.values(day.habits ?? {}).some(Boolean);
  const hasNote = Boolean(day.note?.trim());
  const hasSessions = (day.sessions?.length ?? 0) > 0;
  return !hasHabits && !hasNote && !hasSessions;
}

// --- Sanitization & Backup ---

const trimCap = (val: unknown, max: number): string =>
  typeof val === 'string' ? val.trim().slice(0, max) : '';

const clampInt = (val: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
};

export function cleanSettings(raw: unknown): PlannerSettings {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const dailyCapacityMin = clampInt(src['dailyCapacityMin'], 240, 600, DEFAULT_SETTINGS.dailyCapacityMin);
  const focusRaw = Number(src['focusMinutes']);
  const focusMinutes = (FOCUS_PRESETS as readonly number[]).includes(focusRaw)
    ? focusRaw
    : DEFAULT_SETTINGS.focusMinutes;
  const breakRaw = Number(src['breakMinutes']);
  const breakMinutes = (BREAK_PRESETS as readonly number[]).includes(breakRaw)
    ? breakRaw
    : DEFAULT_SETTINGS.breakMinutes;
  const beep = typeof src['beep'] === 'boolean' ? src['beep'] : DEFAULT_SETTINGS.beep;

  const habits: HabitDef[] = [];
  const seenHabitIds = new Set<string>();
  if (Array.isArray(src['habits'])) {
    for (const item of src['habits']) {
      if (habits.length >= MAX_HABITS) break;
      if (!item || typeof item !== 'object') continue;
      const h = item as Record<string, unknown>;
      const id = trimCap(h['id'], 64);
      const name = trimCap(h['name'], 80);
      if (!id || !name || seenHabitIds.has(id)) continue;
      seenHabitIds.add(id);
      const def: HabitDef = { id, name };
      if (h['archived'] === true) def.archived = true;
      habits.push(def);
    }
  }

  const rSrc =
    src['reminder'] && typeof src['reminder'] === 'object'
      ? (src['reminder'] as Record<string, unknown>)
      : {};
  const daysRaw = Array.isArray(rSrc['days']) ? rSrc['days'] : DEFAULT_REMINDER.days;
  const rDays: number[] = [];
  for (const d of daysRaw) {
    if (typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6 && !rDays.includes(d)) {
      rDays.push(d);
    }
  }
  const reminder = {
    enabled: typeof rSrc['enabled'] === 'boolean' ? rSrc['enabled'] : DEFAULT_REMINDER.enabled,
    time: isTime(rSrc['time']) ? rSrc['time'] : DEFAULT_REMINDER.time,
    days: rDays,
  };

  return { dailyCapacityMin, focusMinutes, breakMinutes, beep, habits, reminder };
}

function cleanTask(raw: unknown): TaskItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const id = trimCap(t['id'], 64);
  const title = trimCap(t['title'], MAX_TITLE_LEN);
  if (!id || !title) return null;

  let date: string | null = null;
  if (t['date'] !== null && t['date'] !== undefined && t['date'] !== '') {
    if (!isIsoDate(t['date'])) return null;
    date = t['date'];
  }

  const startTime = isTime(t['startTime']) ? t['startTime'] : null;
  const durationMin = clampInt(t['durationMin'], MIN_DURATION_MIN, MAX_DURATION_MIN, 30);
  const priority: Priority = t['priority'] === 'high' ? 'high' : 'normal';
  const top3 = t['top3'] === true;
  const category: CategoryId = CATEGORY_IDS.has(t['category'] as CategoryId)
    ? (t['category'] as CategoryId)
    : 'work';

  const subtasks: Subtask[] = [];
  const seenSub = new Set<string>();
  if (Array.isArray(t['subtasks'])) {
    for (const sRaw of t['subtasks']) {
      if (subtasks.length >= MAX_SUBTASKS) break;
      if (!sRaw || typeof sRaw !== 'object') continue;
      const s = sRaw as Record<string, unknown>;
      const sid = trimCap(s['id'], 64);
      const stitle = trimCap(s['title'], MAX_TITLE_LEN);
      if (!sid || !stitle || seenSub.has(sid)) continue;
      seenSub.add(sid);
      subtasks.push({ id: sid, title: stitle, done: s['done'] === true });
    }
  }

  const notes = typeof t['notes'] === 'string' ? t['notes'].slice(0, MAX_NOTES_LEN) : '';
  const done = t['done'] === true;
  const completedAt = done && typeof t['completedAt'] === 'string' ? t['completedAt'].slice(0, 40) : null;
  const rolloverCount = clampInt(t['rolloverCount'], 0, 999, 0);
  const order = clampInt(t['order'], 0, 100000, 0);
  const createdAt =
    typeof t['createdAt'] === 'string' && t['createdAt']
      ? t['createdAt'].slice(0, 40)
      : `${date ?? localToday()}T09:00:00.000Z`;

  return {
    id,
    title,
    date,
    startTime,
    durationMin,
    priority,
    top3,
    category,
    subtasks,
    notes,
    done,
    completedAt,
    rolloverCount,
    order,
    createdAt,
  };
}

function cleanDayRecord(raw: unknown): DayRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  if (!isIsoDate(d['date'])) return null;

  const habits: Record<string, boolean> = {};
  if (d['habits'] && typeof d['habits'] === 'object') {
    for (const [k, v] of Object.entries(d['habits'] as Record<string, unknown>)) {
      const key = trimCap(k, 64);
      if (key && v === true) habits[key] = true;
    }
  }

  const note = typeof d['note'] === 'string' ? d['note'].slice(0, MAX_NOTES_LEN) : '';
  const sessions: FocusSession[] = [];
  const seenSess = new Set<string>();
  if (Array.isArray(d['sessions'])) {
    for (const sRaw of d['sessions']) {
      if (sessions.length >= 200) break;
      if (!sRaw || typeof sRaw !== 'object') continue;
      const s = sRaw as Record<string, unknown>;
      const sid = trimCap(s['id'], 64);
      const rawMin = Number(s['minutes']);
      if (!sid || !Number.isFinite(rawMin) || rawMin < 1 || seenSess.has(sid)) continue;
      const minutes = Math.min(480, Math.round(rawMin));
      seenSess.add(sid);
      const kind = s['kind'] === 'break' ? 'break' : 'focus';
      const taskId = typeof s['taskId'] === 'string' && s['taskId'].trim() ? s['taskId'].trim().slice(0, 64) : null;
      const endedAt = typeof s['endedAt'] === 'string' && s['endedAt'] ? s['endedAt'].slice(0, 40) : `${d['date']}T12:00:00.000Z`;
      sessions.push({ id: sid, taskId, kind, minutes, endedAt });
    }
  }

  const rec: DayRecord = { date: d['date'], habits, note, sessions };
  return isEmptyDayRecord(rec) ? null : rec;
}

function cleanPeriodPlan(raw: unknown): PeriodPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p['id'] !== 'string' || !PLAN_ID_RE.test(p['id'])) return null;
  if (p['id'].startsWith('W:') && !isIsoDate(p['id'].slice(2))) return null;
  if (p['id'].startsWith('M:') && !MONTH_KEY_RE.test(p['id'].slice(2))) return null;

  const goals: GoalItem[] = [];
  const seenGoals = new Set<string>();
  if (Array.isArray(p['goals'])) {
    for (const gRaw of p['goals']) {
      if (goals.length >= MAX_GOALS) break;
      if (!gRaw || typeof gRaw !== 'object') continue;
      const g = gRaw as Record<string, unknown>;
      const gid = trimCap(g['id'], 64);
      const title = trimCap(g['title'], MAX_TITLE_LEN);
      if (!gid || !title || seenGoals.has(gid)) continue;
      seenGoals.add(gid);
      goals.push({ id: gid, title, done: g['done'] === true });
    }
  }

  let reflection: WeeklyReflection | undefined;
  if (p['id'].startsWith('W:') && p['reflection'] && typeof p['reflection'] === 'object') {
    const r = p['reflection'] as Record<string, unknown>;
    const wins = typeof r['wins'] === 'string' ? r['wins'].slice(0, MAX_NOTES_LEN) : '';
    const slipped = typeof r['slipped'] === 'string' ? r['slipped'].slice(0, MAX_NOTES_LEN) : '';
    const nextFocus = typeof r['nextFocus'] === 'string' ? r['nextFocus'].slice(0, MAX_NOTES_LEN) : '';
    if (wins.trim() || slipped.trim() || nextFocus.trim()) {
      reflection = { wins, slipped, nextFocus };
    }
  }

  if (goals.length === 0 && !reflection) return null;
  return reflection ? { id: p['id'], goals, reflection } : { id: p['id'], goals };
}

export function makeBackup(
  tasks: readonly TaskItem[],
  days: readonly DayRecord[],
  plans: readonly PeriodPlan[],
  settings: PlannerSettings,
  exportedAt = new Date().toISOString(),
): string {
  const payload: BackupData = {
    app: 'daily-planner',
    version: 1,
    exportedAt,
    tasks: [...tasks],
    days: days.filter(d => !isEmptyDayRecord(d)),
    plans: [...plans],
    settings,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseBackup(text: string): BackupData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Daily Planner backup.');
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('This file is not a Daily Planner backup.');
  }
  const obj = raw as Record<string, unknown>;
  if (obj['app'] !== 'daily-planner' || !Array.isArray(obj['tasks'])) {
    throw new Error('This file is not a Daily Planner backup.');
  }

  const tasks: TaskItem[] = [];
  const seenTasks = new Set<string>();
  const top3PerScope = new Map<string, number>();
  for (const item of obj['tasks']) {
    const cleaned = cleanTask(item);
    if (!cleaned || seenTasks.has(cleaned.id)) continue;
    seenTasks.add(cleaned.id);
    if (cleaned.top3) {
      const scope = cleaned.date ?? '__undated__';
      const n = top3PerScope.get(scope) ?? 0;
      if (n >= MAX_TOP3) {
        cleaned.top3 = false;
      } else {
        top3PerScope.set(scope, n + 1);
      }
    }
    tasks.push(cleaned);
  }

  const days: DayRecord[] = [];
  const seenDays = new Set<string>();
  if (Array.isArray(obj['days'])) {
    for (const item of obj['days']) {
      const cleaned = cleanDayRecord(item);
      if (!cleaned || seenDays.has(cleaned.date)) continue;
      seenDays.add(cleaned.date);
      days.push(cleaned);
    }
  }

  const plans: PeriodPlan[] = [];
  const seenPlans = new Set<string>();
  if (Array.isArray(obj['plans'])) {
    for (const item of obj['plans']) {
      const cleaned = cleanPeriodPlan(item);
      if (!cleaned || seenPlans.has(cleaned.id)) continue;
      seenPlans.add(cleaned.id);
      plans.push(cleaned);
    }
  }

  const settings = cleanSettings(obj['settings']);
  const exportedAt =
    typeof obj['exportedAt'] === 'string' ? obj['exportedAt'].slice(0, 40) : new Date().toISOString();

  return {
    app: 'daily-planner',
    version: 1,
    exportedAt,
    tasks,
    days,
    plans,
    settings,
  };
}
