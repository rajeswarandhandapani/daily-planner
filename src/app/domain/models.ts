import type { ReminderConfig } from '../kit/ics';

export type Priority = 'normal' | 'high';
export type CategoryId =
  | 'work'
  | 'personal'
  | 'household'
  | 'family'
  | 'children'
  | 'health'
  | 'finance'
  | 'errands';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  colorVar: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  { id: 'work', label: 'Work', colorVar: '--dp-cat-work' },
  { id: 'personal', label: 'Personal', colorVar: '--dp-cat-personal' },
  { id: 'household', label: 'Household', colorVar: '--dp-cat-household' },
  { id: 'family', label: 'Family', colorVar: '--dp-cat-family' },
  { id: 'children', label: 'Children', colorVar: '--dp-cat-children' },
  { id: 'health', label: 'Health', colorVar: '--dp-cat-health' },
  { id: 'finance', label: 'Finance', colorVar: '--dp-cat-finance' },
  { id: 'errands', label: 'Errands', colorVar: '--dp-cat-errands' },
] as const;

export const CATEGORY_IDS = new Set<CategoryId>(CATEGORIES.map(c => c.id));

export const MAX_TOP3 = 3;
export const MAX_SUBTASKS = 20;
export const MAX_GOALS = 10;
export const MAX_HABITS = 20;
export const MAX_TITLE_LEN = 180;
export const MAX_NOTES_LEN = 2000;
export const MIN_DURATION_MIN = 5;
export const MAX_DURATION_MIN = 480;

export const DURATION_PRESETS = [15, 30, 45, 60, 90] as const;
export const CAPACITY_PRESETS = [240, 300, 360, 420, 480, 600] as const;
export const FOCUS_PRESETS = [15, 25, 45, 50] as const;
export const BREAK_PRESETS = [5, 10] as const;

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskItem {
  id: string;
  /** Links a pulled daily plan task back to its parent task in the Unfinished Bucket. */
  sourceTaskId?: string | null;
  title: string;
  /** ISO date YYYY-MM-DD when scheduled, or null when undated. */
  date: string | null;
  startTime: string | null; // HH:MM or null
  durationMin: number;
  priority: Priority;
  top3: boolean;
  category: CategoryId;
  subtasks: Subtask[];
  notes: string;
  done: boolean;
  completedAt: string | null;
  rolloverCount: number;
  order: number;
  createdAt: string;
}

export interface FocusSession {
  id: string;
  taskId: string | null;
  kind: 'focus' | 'break';
  minutes: number;
  endedAt: string;
}

export interface DayRecord {
  date: string;
  habits: Record<string, boolean>;
  note: string;
  sessions: FocusSession[];
}

export interface HabitDef {
  id: string;
  name: string;
  archived?: boolean;
}

export interface GoalItem {
  id: string;
  title: string;
  done: boolean;
}

export interface WeeklyReflection {
  wins: string;
  slipped: string;
  nextFocus: string;
}

export interface PeriodPlan {
  id: string; // 'W:YYYY-MM-DD' | 'M:YYYY-MM'
  goals: GoalItem[];
  reflection?: WeeklyReflection;
}

export interface PlannerSettings {
  dailyCapacityMin: number;
  focusMinutes: number;
  breakMinutes: number;
  beep: boolean;
  habits: HabitDef[];
  reminder: ReminderConfig;
}

export interface BackupData {
  app: 'daily-planner';
  version: number;
  exportedAt: string;
  tasks: TaskItem[];
  days: DayRecord[];
  plans: PeriodPlan[];
  settings: PlannerSettings;
}

export const DEFAULT_REMINDER: ReminderConfig = {
  enabled: false,
  time: '08:00',
  days: [1, 2, 3, 4, 5],
};

export const DEFAULT_SETTINGS: PlannerSettings = {
  dailyCapacityMin: 360,
  focusMinutes: 25,
  breakMinutes: 5,
  beep: true,
  habits: [],
  reminder: { ...DEFAULT_REMINDER, days: [...DEFAULT_REMINDER.days] },
};
