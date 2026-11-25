import { Injectable, computed, inject, signal } from '@angular/core';
import { ToastService } from '../kit/toast.service';
import {
  carryForwardPending,
  cleanSettings,
  focusByTask,
  isEmptyDayRecord,
  localToday,
  mondayOf,
  monthKey,
  overdueTasks,
  parseBackup,
  rolloverTo,
  top3CountOnScope,
} from '../domain/logic';
import {
  type BackupData,
  type CategoryId,
  type DayRecord,
  DEFAULT_SETTINGS,
  type FocusSession,
  type GoalItem,
  type HabitDef,
  MAX_GOALS,
  MAX_HABITS,
  MAX_SUBTASKS,
  MAX_TOP3,
  type PeriodPlan,
  type PlannerSettings,
  type Priority,
  type Subtask,
  type TaskItem,
  type WeeklyReflection,
} from '../domain/models';
import { PlannerStoreService } from './planner-store.service';

export type TodayViewMode = 'grouped' | 'timeline';

export interface NewTaskInput {
  title: string;
  date?: string | null;
  startTime?: string | null;
  durationMin?: number;
  priority?: Priority;
  top3?: boolean;
  category?: CategoryId;
  notes?: string;
}

const MODE_KEY = 'dp-today-mode';

function uid(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

@Injectable({ providedIn: 'root' })
export class PlannerStateService {
  private readonly store = inject(PlannerStoreService);
  private readonly toast = inject(ToastService);

  readonly today = signal(localToday());
  readonly selectedDate = signal(localToday());
  readonly weekMonday = signal(mondayOf(localToday()));
  readonly month = signal(monthKey(localToday()));
  readonly todayMode = signal<TodayViewMode>(this.readMode());

  readonly tasks = signal<TaskItem[]>([]);
  readonly days = signal<Record<string, DayRecord>>({});
  readonly plans = signal<Record<string, PeriodPlan>>({});
  readonly settings = signal<PlannerSettings>({ ...DEFAULT_SETTINGS });
  readonly lastBackup = signal<string | null>(null);
  readonly lastReminder = signal<string | null>(null);

  readonly tasksByDate = computed(() => {
    const map: Record<string, TaskItem[]> = {};
    for (const t of this.tasks()) {
      if (t.date === null) continue;
      (map[t.date] ??= []).push(t);
    }
    return map;
  });

  readonly undatedTasks = computed(() => this.tasks().filter(t => t.date === null));
  readonly overdue = computed(() => overdueTasks(this.tasks(), this.today()));
  readonly focusMinutesByTask = computed(() => focusByTask(this.days()));
  readonly activeHabits = computed(() => this.settings().habits.filter(h => !h.archived));

  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const now = localToday();
    this.today.set(now);
    this.selectedDate.set(now);
    this.weekMonday.set(mondayOf(now));
    this.month.set(monthKey(now));

    const [tasks, dayList, planList, rawSettings, lastBackup, lastReminder] = await Promise.all([
      this.store.getAllTasks(),
      this.store.getAllDays(),
      this.store.getAllPlans(),
      this.store.getKv<PlannerSettings>('settings'),
      this.store.getKv<string>('lastBackup'),
      this.store.getKv<string>('lastReminder'),
    ]);

    this.tasks.set(tasks);
    const dayMap: Record<string, DayRecord> = {};
    for (const d of dayList) dayMap[d.date] = d;
    this.days.set(dayMap);

    const planMap: Record<string, PeriodPlan> = {};
    for (const p of planList) planMap[p.id] = p;
    this.plans.set(planMap);

    this.settings.set(cleanSettings(rawSettings));
    this.lastBackup.set(lastBackup ?? null);
    this.lastReminder.set(lastReminder ?? null);

    await this.autoCarryForward(now);
  }

  refreshTodayIfChanged(): void {
    const now = localToday();
    if (now !== this.today()) {
      const wasOnToday = this.selectedDate() === this.today();
      this.today.set(now);
      if (wasOnToday) this.selectedDate.set(now);
      void this.autoCarryForward(now);
    }
  }

  private async autoCarryForward(todayIso: string): Promise<void> {
    const res = carryForwardPending(this.tasks(), todayIso);
    if (res.movedCount === 0) return;

    this.tasks.set(res.tasks);
    const movedSet = new Set(res.previous.map(p => p.id));
    await this.store.putTasks(res.tasks.filter(t => movedSet.has(t.id)));

    const msg = `Carried ${res.movedCount} pending ${res.movedCount === 1 ? 'task' : 'tasks'} to today.`;
    this.toast.show(msg, {
      label: 'Undo',
      run: () => {
        const prevMap = new Map(res.previous.map(p => [p.id, p]));
        this.tasks.update(list => list.map(t => prevMap.get(t.id) ?? t));
        void this.store.putTasks(res.previous);
      },
    });
  }

  openDate(iso: string): void {
    this.selectedDate.set(iso);
    this.weekMonday.set(mondayOf(iso));
    this.month.set(monthKey(iso));
  }

  setTodayMode(mode: TodayViewMode): void {
    this.todayMode.set(mode);
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {}
  }

  private readMode(): TodayViewMode {
    try {
      return localStorage.getItem(MODE_KEY) === 'timeline' ? 'timeline' : 'grouped';
    } catch {
      return 'grouped';
    }
  }

  // --- Tasks ---

  async addTask(input: NewTaskInput): Promise<TaskItem | null> {
    const title = input.title.trim();
    if (!title) {
      this.toast.show('Enter a task title.');
      return null;
    }
    const targetDate = input.date ?? null;
    const wantTop3 = input.top3 === true;
    if (wantTop3 && top3CountOnScope(this.tasks(), targetDate) >= MAX_TOP3) {
      const scopeLabel = targetDate ? 'on that day' : 'among undated tasks';
      this.toast.show(`You already have ${MAX_TOP3} Top 3 priorities ${scopeLabel}.`);
      return null;
    }

    const existingInScope = targetDate ? (this.tasksByDate()[targetDate] ?? []) : this.undatedTasks();
    const maxOrder = existingInScope.reduce((m, t) => Math.max(m, t.order), -1);
    const created: TaskItem = {
      id: uid('t'),
      title: title.slice(0, 180),
      date: targetDate,
      startTime: input.startTime || null,
      durationMin: Math.max(5, Math.min(480, Math.round(input.durationMin ?? 30))),
      priority: input.priority === 'high' ? 'high' : 'normal',
      top3: wantTop3,
      category: input.category ?? 'work',
      subtasks: [],
      notes: (input.notes ?? '').slice(0, 2000),
      done: false,
      completedAt: null,
      rolloverCount: 0,
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
    };

    this.tasks.update(list => [...list, created]);
    await this.store.putTask(created);
    return created;
  }

  async updateTask(id: string, patch: Partial<TaskItem>): Promise<boolean> {
    const current = this.tasks().find(t => t.id === id);
    if (!current) return false;

    const targetDate = patch.date !== undefined ? patch.date : current.date;
    const nextTop3 = patch.top3 ?? current.top3;
    if (nextTop3 && top3CountOnScope(this.tasks(), targetDate, id) >= MAX_TOP3) {
      this.toast.show(`Already ${MAX_TOP3} Top 3 priorities on that scope.`);
      return false;
    }

    const updated: TaskItem = {
      ...current,
      ...patch,
      date: targetDate,
      title: (patch.title ?? current.title).trim().slice(0, 180) || current.title,
      durationMin: Math.max(5, Math.min(480, Math.round(patch.durationMin ?? current.durationMin))),
      notes: (patch.notes ?? current.notes).slice(0, 2000),
      subtasks: (patch.subtasks ?? current.subtasks).slice(0, MAX_SUBTASKS),
    };

    this.tasks.update(list => list.map(t => (t.id === id ? updated : t)));
    await this.store.putTask(updated);
    return true;
  }

  async toggleDone(id: string): Promise<void> {
    const current = this.tasks().find(t => t.id === id);
    if (!current) return;
    const done = !current.done;
    const updated: TaskItem = {
      ...current,
      done,
      completedAt: done ? new Date().toISOString() : null,
    };
    this.tasks.update(list => list.map(t => (t.id === id ? updated : t)));
    await this.store.putTask(updated);
  }

  async toggleTop3(id: string): Promise<void> {
    const current = this.tasks().find(t => t.id === id);
    if (!current) return;
    const nextTop3 = !current.top3;
    if (nextTop3 && top3CountOnScope(this.tasks(), current.date, id) >= MAX_TOP3) {
      this.toast.show(`You can pick at most ${MAX_TOP3} Top 3 priorities.`);
      return;
    }
    const updated: TaskItem = { ...current, top3: nextTop3 };
    this.tasks.update(list => list.map(t => (t.id === id ? updated : t)));
    await this.store.putTask(updated);
  }

  async deleteTask(id: string): Promise<void> {
    const target = this.tasks().find(t => t.id === id);
    if (!target) return;
    this.tasks.update(list => list.filter(t => t.id !== id));
    await this.store.deleteTask(id);
    this.toast.show(`Deleted “${target.title}”.`, {
      label: 'Undo',
      run: () => {
        this.tasks.update(list => [...list, target]);
        void this.store.putTask(target);
      },
    });
  }

  async moveTask(
    id: string,
    targetDate: string | null,
    { countRollover = false }: { countRollover?: boolean } = {},
  ): Promise<void> {
    const current = this.tasks().find(t => t.id === id);
    if (!current || current.date === targetDate) return;
    const prev = { ...current, subtasks: current.subtasks.map(s => ({ ...s })) };

    let nextTop3 = current.top3;
    let demoted = false;
    if (nextTop3 && top3CountOnScope(this.tasks(), targetDate, id) >= MAX_TOP3) {
      nextTop3 = false;
      demoted = true;
    }

    const updated: TaskItem = {
      ...current,
      date: targetDate,
      top3: nextTop3,
      rolloverCount: countRollover ? current.rolloverCount + 1 : current.rolloverCount,
    };

    this.tasks.update(list => list.map(t => (t.id === id ? updated : t)));
    await this.store.putTask(updated);

    const msg = demoted
      ? `Moved “${current.title}” (Top 3 cleared — target already has ${MAX_TOP3}).`
      : targetDate === null
        ? `Cleared date on “${current.title}”.`
        : `Moved “${current.title}”.`;
    this.toast.show(msg, {
      label: 'Undo',
      run: () => {
        this.tasks.update(list => list.map(t => (t.id === id ? prev : t)));
        void this.store.putTask(prev);
      },
    });
  }

  async rolloverTasks(ids: string[], targetIso: string): Promise<void> {
    if (!ids.length) return;
    const res = rolloverTo(this.tasks(), ids, targetIso);
    if (res.movedCount === 0) return;

    this.tasks.set(res.tasks);
    const movedSet = new Set(res.previous.map(p => p.id));
    await this.store.putTasks(res.tasks.filter(t => movedSet.has(t.id)));

    const base = `Moved ${res.movedCount} ${res.movedCount === 1 ? 'task' : 'tasks'}.`;
    const msg =
      res.demotedTop3Count > 0
        ? `${base} ${res.demotedTop3Count} cleared from Top 3 (max ${MAX_TOP3}/day).`
        : base;
    this.toast.show(msg, {
      label: 'Undo',
      run: () => {
        const prevMap = new Map(res.previous.map(p => [p.id, p]));
        this.tasks.update(list => list.map(t => prevMap.get(t.id) ?? t));
        void this.store.putTasks(res.previous);
      },
    });
  }

  async addSubtask(taskId: string, title: string): Promise<void> {
    const clean = title.trim();
    if (!clean) return;
    const current = this.tasks().find(t => t.id === taskId);
    if (!current || current.subtasks.length >= MAX_SUBTASKS) return;
    const nextSub: Subtask = { id: uid('sub'), title: clean.slice(0, 180), done: false };
    await this.updateTask(taskId, { subtasks: [...current.subtasks, nextSub] });
  }

  async toggleSubtask(taskId: string, subId: string): Promise<void> {
    const current = this.tasks().find(t => t.id === taskId);
    if (!current) return;
    const subtasks = current.subtasks.map(s => (s.id === subId ? { ...s, done: !s.done } : s));
    await this.updateTask(taskId, { subtasks });
  }

  async deleteSubtask(taskId: string, subId: string): Promise<void> {
    const current = this.tasks().find(t => t.id === taskId);
    if (!current) return;
    const subtasks = current.subtasks.filter(s => s.id !== subId);
    await this.updateTask(taskId, { subtasks });
  }

  // --- Day Records (Habits, Notes, Focus Sessions) ---

  private getOrCreateDay(date: string): DayRecord {
    const existing = this.days()[date];
    return existing
      ? {
          date,
          habits: { ...existing.habits },
          note: existing.note,
          sessions: [...existing.sessions],
        }
      : { date, habits: {}, note: '', sessions: [] };
  }

  private async saveDay(record: DayRecord): Promise<void> {
    if (isEmptyDayRecord(record)) {
      this.days.update(map => {
        const next = { ...map };
        delete next[record.date];
        return next;
      });
      await this.store.deleteDay(record.date);
    } else {
      this.days.update(map => ({ ...map, [record.date]: record }));
      await this.store.putDay(record);
    }
  }

  async toggleHabit(date: string, habitId: string): Promise<void> {
    const day = this.getOrCreateDay(date);
    if (day.habits[habitId]) delete day.habits[habitId];
    else day.habits[habitId] = true;
    await this.saveDay(day);
  }

  async saveDayNote(date: string, note: string): Promise<void> {
    const day = this.getOrCreateDay(date);
    day.note = note.slice(0, 2000);
    await this.saveDay(day);
  }

  async logSession(
    date: string,
    taskId: string | null,
    kind: 'focus' | 'break',
    minutes: number,
  ): Promise<void> {
    const mins = Math.max(1, Math.min(480, Math.round(minutes)));
    const day = this.getOrCreateDay(date);
    const session: FocusSession = {
      id: uid('fs'),
      taskId,
      kind,
      minutes: mins,
      endedAt: new Date().toISOString(),
    };
    day.sessions.push(session);
    await this.saveDay(day);
  }

  // --- Habits Management ---

  async addHabit(name: string): Promise<boolean> {
    const clean = name.trim().slice(0, 80);
    if (!clean) {
      this.toast.show('Enter a habit name.');
      return false;
    }
    const cur = this.settings().habits;
    if (cur.length >= MAX_HABITS) {
      this.toast.show(`You can track up to ${MAX_HABITS} habits.`);
      return false;
    }
    if (cur.some(h => h.name.toLowerCase() === clean.toLowerCase())) {
      this.toast.show('That habit already exists.');
      return false;
    }
    const nextHabit: HabitDef = { id: uid('hab'), name: clean };
    await this.updateSettings(prev => ({ ...prev, habits: [...prev.habits, nextHabit] }));
    return true;
  }

  async renameHabit(habitId: string, name: string): Promise<void> {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    await this.updateSettings(prev => ({
      ...prev,
      habits: prev.habits.map(h => (h.id === habitId ? { ...h, name: clean } : h)),
    }));
  }

  async toggleHabitArchived(habitId: string): Promise<void> {
    await this.updateSettings(prev => ({
      ...prev,
      habits: prev.habits.map(h => (h.id === habitId ? { ...h, archived: !h.archived } : h)),
    }));
  }

  async deleteHabit(habitId: string): Promise<void> {
    await this.updateSettings(prev => ({
      ...prev,
      habits: prev.habits.filter(h => h.id !== habitId),
    }));
  }

  // --- Period Plans (Weekly / Monthly Goals & Reflection) ---

  private getOrCreatePlan(id: string): PeriodPlan {
    const existing = this.plans()[id];
    return existing
      ? {
          id,
          goals: existing.goals.map(g => ({ ...g })),
          ...(existing.reflection ? { reflection: { ...existing.reflection } } : {}),
        }
      : { id, goals: [] };
  }

  private async savePlan(plan: PeriodPlan): Promise<void> {
    const hasReflection = Boolean(
      plan.reflection &&
        (plan.reflection.wins.trim() ||
          plan.reflection.slipped.trim() ||
          plan.reflection.nextFocus.trim()),
    );
    if (plan.goals.length === 0 && !hasReflection) {
      this.plans.update(map => {
        const next = { ...map };
        delete next[plan.id];
        return next;
      });
      await this.store.deletePlan(plan.id);
    } else {
      const cleaned: PeriodPlan = hasReflection
        ? { id: plan.id, goals: plan.goals, reflection: plan.reflection }
        : { id: plan.id, goals: plan.goals };
      this.plans.update(map => ({ ...map, [plan.id]: cleaned }));
      await this.store.putPlan(cleaned);
    }
  }

  async addGoal(planId: string, title: string): Promise<void> {
    const clean = title.trim().slice(0, 180);
    if (!clean) return;
    const plan = this.getOrCreatePlan(planId);
    if (plan.goals.length >= MAX_GOALS) {
      this.toast.show(`Up to ${MAX_GOALS} goals per period.`);
      return;
    }
    const goal: GoalItem = { id: uid('g'), title: clean, done: false };
    plan.goals.push(goal);
    await this.savePlan(plan);
  }

  async toggleGoal(planId: string, goalId: string): Promise<void> {
    const plan = this.getOrCreatePlan(planId);
    plan.goals = plan.goals.map(g => (g.id === goalId ? { ...g, done: !g.done } : g));
    await this.savePlan(plan);
  }

  async deleteGoal(planId: string, goalId: string): Promise<void> {
    const plan = this.getOrCreatePlan(planId);
    plan.goals = plan.goals.filter(g => g.id !== goalId);
    await this.savePlan(plan);
  }

  async saveReflection(planId: string, reflection: WeeklyReflection): Promise<void> {
    const plan = this.getOrCreatePlan(planId);
    plan.reflection = {
      wins: reflection.wins.slice(0, 2000),
      slipped: reflection.slipped.slice(0, 2000),
      nextFocus: reflection.nextFocus.slice(0, 2000),
    };
    await this.savePlan(plan);
  }

  // --- Settings, Backup, Restore & Erase ---

  async updateSettings(updater: (prev: PlannerSettings) => PlannerSettings): Promise<void> {
    const next = cleanSettings(updater(this.settings()));
    this.settings.set(next);
    await this.store.setKv('settings', next);
  }

  async recordBackupExported(isoTimestamp: string): Promise<void> {
    this.lastBackup.set(isoTimestamp);
    await this.store.setKv('lastBackup', isoTimestamp);
    this.toast.show('Backup downloaded.');
  }

  restoreFromBackupText(text: string): BackupData | null {
    try {
      return parseBackup(text);
    } catch (err) {
      this.toast.show(err instanceof Error ? err.message : 'Could not read backup file.');
      return null;
    }
  }

  async applyRestoredBackup(data: BackupData): Promise<void> {
    await this.store.replaceAll(data.tasks, data.days, data.plans, data.settings);
    this.tasks.set(data.tasks);
    const dayMap: Record<string, DayRecord> = {};
    for (const d of data.days) dayMap[d.date] = d;
    this.days.set(dayMap);
    const planMap: Record<string, PeriodPlan> = {};
    for (const p of data.plans) planMap[p.id] = p;
    this.plans.set(planMap);
    this.settings.set(data.settings);
    this.lastBackup.set(null);
    this.lastReminder.set(null);
    this.toast.show('Backup restored.');
  }

  async eraseAllData(): Promise<void> {
    await this.store.eraseAll();
    this.tasks.set([]);
    this.days.set({});
    this.plans.set({});
    this.settings.set(cleanSettings({}));
    this.lastBackup.set(null);
    this.lastReminder.set(null);
    this.toast.show('All data erased.');
  }
}
