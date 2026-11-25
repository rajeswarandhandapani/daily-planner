import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ConfirmDialogService } from '../../kit/confirm-dialog.service';
import { shortDate } from '../../kit/dates';
import { downloadFile } from '../../kit/storage-utils';
import { KIT_THEMES, ThemeService } from '../../kit/theme.service';
import { ToastService } from '../../kit/toast.service';
import { makeReminderIcs, makeScheduleIcs } from '../../domain/calendar-ics';
import {
  addDays,
  cleanSettings,
  formatDuration,
  fromIso,
  habitHasHistory,
  makeBackup,
  reminderSummary,
} from '../../domain/logic';
import {
  BREAK_PRESETS,
  CAPACITY_PRESETS,
  FOCUS_PRESETS,
  type HabitDef,
} from '../../domain/models';
import { PlannerStateService } from '../../services/planner-state.service';
import { PlannerStoreService } from '../../services/planner-store.service';
import { ReminderService } from '../../services/reminder.service';

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

@Component({
  selector: 'dp-data-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="text-2xl font-bold tracking-tight">Data</h1>

    <!-- Appearance -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Appearance</h2>
        <label class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span class="text-sm opacity-80">Theme</span>
          <select
            class="select select-bordered w-full sm:w-56 min-h-11"
            aria-label="Theme"
            [value]="themeSvc.theme()"
            (change)="onThemeChange($event)"
          >
            @for (t of themes; track t.id) {
              <option [value]="t.id" [selected]="t.id === themeSvc.theme()">{{ t.label }}</option>
            }
          </select>
        </label>
      </div>
    </section>

    <!-- Planner & Focus Settings -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Planner &amp; focus timer</h2>

        <label class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span class="text-sm opacity-80">Daily capacity</span>
          <select
            class="select select-bordered w-full sm:w-56 min-h-11"
            aria-label="Daily capacity"
            [value]="'' + state.settings().dailyCapacityMin"
            (change)="onCapacityChange($event)"
          >
            @for (c of capacityPresets; track c) {
              <option [value]="c" [selected]="c === state.settings().dailyCapacityMin">
                {{ formatDur(c) }} per day
              </option>
            }
          </select>
        </label>

        <label class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span class="text-sm opacity-80">Focus session length</span>
          <select
            class="select select-bordered w-full sm:w-56 min-h-11"
            aria-label="Focus session length"
            [value]="'' + state.settings().focusMinutes"
            (change)="onFocusChange($event)"
          >
            @for (m of focusPresets; track m) {
              <option [value]="m" [selected]="m === state.settings().focusMinutes">
                {{ m }} minutes
              </option>
            }
          </select>
        </label>

        <label class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span class="text-sm opacity-80">Short break length</span>
          <select
            class="select select-bordered w-full sm:w-56 min-h-11"
            aria-label="Short break length"
            [value]="'' + state.settings().breakMinutes"
            (change)="onBreakChange($event)"
          >
            @for (m of breakPresets; track m) {
              <option [value]="m" [selected]="m === state.settings().breakMinutes">
                {{ m }} min (15m every 4th)
              </option>
            }
          </select>
        </label>

        <label class="flex items-center gap-2.5 min-h-11 cursor-pointer">
          <input
            type="checkbox"
            class="checkbox checkbox-primary checkbox-sm"
            [checked]="state.settings().beep"
            (change)="onBeepChange($event)"
          />
          <span class="text-sm">Chime when focus session ends</span>
        </label>
      </div>
    </section>

    <!-- Habits Manager -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Habits</h2>
        <form class="flex gap-2" (submit)="addHabit($event)">
          <input
            type="text"
            class="input input-bordered flex-1 min-h-11"
            placeholder="New habit name…"
            aria-label="Add habit"
            [value]="newHabit()"
            (input)="newHabit.set(asValue($event))"
          />
          <button type="submit" class="btn btn-outline min-h-11">Add</button>
        </form>

        @for (h of state.settings().habits; track h.id) {
          <div class="flex items-center justify-between gap-2 py-1.5 border-t border-base-300">
            <span class="text-sm" [class.opacity-50]="h.archived" [class.line-through]="h.archived">
              {{ h.name }}
            </span>
            <div class="flex items-center gap-2 text-xs">
              <button
                type="button"
                class="link opacity-80"
                (click)="state.toggleHabitArchived(h.id)"
              >
                {{ h.archived ? 'Restore' : 'Archive' }}
              </button>
              @if (!hasHistory(h)) {
                <button
                  type="button"
                  class="link text-error"
                  [attr.aria-label]="'Delete habit ' + h.name"
                  (click)="state.deleteHabit(h.id)"
                >
                  Delete
                </button>
              }
            </div>
          </div>
        }
      </div>
    </section>

    <!-- Reminders & Calendar (.ics) -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Reminders &amp; calendar</h2>
        <p class="text-xs opacity-75 m-0">Today’s summary: {{ todaySummary() }}</p>

        <label class="flex items-center gap-2.5 min-h-11 cursor-pointer">
          <input
            type="checkbox"
            class="checkbox checkbox-primary checkbox-sm"
            aria-label="Daily planning reminder"
            [checked]="state.settings().reminder.enabled"
            (change)="onReminderToggle($event)"
          />
          <span class="text-sm">Daily planning reminder</span>
        </label>

        <label class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span class="text-sm opacity-80">Reminder time</span>
          <input
            type="time"
            class="input input-bordered w-full sm:w-56 min-h-11"
            aria-label="Reminder time"
            [value]="state.settings().reminder.time"
            (change)="onReminderTimeChange($event)"
          />
        </label>

        <div class="flex flex-wrap gap-1.5">
          @for (chip of dayChips; track chip.dayIndex) {
            <button
              type="button"
              class="btn btn-sm btn-outline rounded-full day-chip min-h-9 px-3"
              [attr.aria-pressed]="'' + state.settings().reminder.days.includes(chip.dayIndex)"
              [attr.aria-label]="'Remind on ' + chip.longName"
              (click)="toggleReminderDay(chip.dayIndex)"
            >
              {{ chip.label }}
            </button>
          }
        </div>

        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-outline btn-sm min-h-10" (click)="testReminder()">
            Test reminder
          </button>
          <button type="button" class="btn btn-outline btn-sm min-h-10" (click)="downloadReminderIcs()">
            Reminder calendar (.ics)
          </button>
          <button type="button" class="btn btn-outline btn-sm min-h-10" (click)="downloadScheduleIcs()">
            Export schedule (.ics)
          </button>
        </div>
      </div>
    </section>

    <!-- Backup -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Backup</h2>
        <p class="text-sm m-0">
          {{ state.tasks().length }} {{ state.tasks().length === 1 ? 'task' : 'tasks' }} saved on
          this device. Nothing leaves your browser, so download a backup occasionally.
        </p>
        <p class="text-xs opacity-75 m-0">
          @if (state.lastBackup(); as ts) {
            Last backup: {{ formatShort(ts.slice(0, 10)) }}
          } @else {
            No backup yet.
          }
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary min-h-11" (click)="exportBackup()">
            Download backup
          </button>
          <button type="button" class="btn btn-outline min-h-11" (click)="restoreInput.click()">
            Restore a backup
          </button>
        </div>
        <input
          #restoreInput
          type="file"
          accept=".json,application/json"
          hidden
          (change)="onFileSelected($event)"
        />
      </div>
    </section>

    <!-- Erase -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Erase</h2>
        <div>
          <button type="button" class="btn btn-outline btn-error min-h-11" (click)="confirmErase()">
            Erase all data
          </button>
        </div>
      </div>
    </section>
  `,
})
export class DataPageComponent {
  readonly state = inject(PlannerStateService);
  readonly themeSvc = inject(ThemeService);
  private readonly store = inject(PlannerStoreService);
  private readonly reminder = inject(ReminderService);
  private readonly confirmDlg = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly themes = KIT_THEMES;
  readonly capacityPresets = CAPACITY_PRESETS;
  readonly focusPresets = FOCUS_PRESETS;
  readonly breakPresets = BREAK_PRESETS;
  readonly newHabit = signal('');

  readonly dayChips = DAY_ORDER.map(d => {
    const dt = fromIso(addDays('2026-11-23', (d + 6) % 7));
    return {
      dayIndex: d,
      longName: LONG_DAY.format(dt),
      label: SHORT_DAY.format(dt),
    };
  });

  readonly todaySummary = computed(() => {
    const s = reminderSummary(this.state.tasks(), this.state.today());
    return `${s.title} — ${s.body}`;
  });

  formatDur(min: number): string {
    return formatDuration(min);
  }

  formatShort(iso: string): string {
    return shortDate(iso);
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  hasHistory(habit: HabitDef): boolean {
    return habitHasHistory(this.state.days(), habit.id);
  }

  onThemeChange(event: Event): void {
    this.themeSvc.setTheme((event.target as HTMLSelectElement).value);
  }

  onCapacityChange(event: Event): void {
    const dailyCapacityMin = Number((event.target as HTMLSelectElement).value);
    void this.state.updateSettings(prev => ({ ...prev, dailyCapacityMin }));
  }

  onFocusChange(event: Event): void {
    const focusMinutes = Number((event.target as HTMLSelectElement).value);
    void this.state.updateSettings(prev => ({ ...prev, focusMinutes }));
  }

  onBreakChange(event: Event): void {
    const breakMinutes = Number((event.target as HTMLSelectElement).value);
    void this.state.updateSettings(prev => ({ ...prev, breakMinutes }));
  }

  onBeepChange(event: Event): void {
    const beep = (event.target as HTMLInputElement).checked;
    void this.state.updateSettings(prev => ({ ...prev, beep }));
  }

  async addHabit(event: Event): Promise<void> {
    event.preventDefault();
    const ok = await this.state.addHabit(this.newHabit());
    if (ok) this.newHabit.set('');
  }

  async onReminderToggle(event: Event): Promise<void> {
    const enabled = (event.target as HTMLInputElement).checked;
    await this.state.updateSettings(prev => ({
      ...prev,
      reminder: { ...prev.reminder, enabled },
    }));
    if (enabled && typeof Notification !== 'undefined') {
      const perm =
        Notification.permission === 'default'
          ? await Notification.requestPermission?.().catch(() => Notification.permission)
          : Notification.permission;
      if (perm === 'denied') {
        this.toast.show('Browser notifications blocked. Use Reminder calendar (.ics) instead.');
      }
    }
    if (enabled) void this.reminder.check();
  }

  async onReminderTimeChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const cur = this.state.settings().reminder;
    const next = cleanSettings({ reminder: { ...cur, time: input.value } }).reminder.time;
    this.state.lastReminder.set(null);
    await this.store.setKv('lastReminder', null);
    await this.state.updateSettings(prev => ({
      ...prev,
      reminder: { ...prev.reminder, time: next },
    }));
    void this.reminder.check();
  }

  toggleReminderDay(dayIndex: number): void {
    void this.state.updateSettings(prev => {
      const cur = prev.reminder.days;
      const days = cur.includes(dayIndex) ? cur.filter(x => x !== dayIndex) : [...cur, dayIndex];
      return { ...prev, reminder: { ...prev.reminder, days } };
    });
  }

  testReminder(): void {
    void this.reminder.show(this.state.today(), { test: true });
  }

  downloadReminderIcs(): void {
    downloadFile(
      'daily-planner-reminders.ics',
      makeReminderIcs(this.state.settings(), this.state.today(), this.state.tasks()),
      'text/calendar',
    );
    this.toast.show('Reminder calendar downloaded.');
  }

  downloadScheduleIcs(): void {
    downloadFile(
      'daily-planner-schedule.ics',
      makeScheduleIcs(this.state.tasks(), this.state.today()),
      'text/calendar',
    );
    this.toast.show('Schedule calendar downloaded.');
  }

  async exportBackup(): Promise<void> {
    const now = new Date().toISOString();
    downloadFile(
      `daily-planner-${this.state.today()}.json`,
      makeBackup(
        this.state.tasks(),
        Object.values(this.state.days()),
        Object.values(this.state.plans()),
        this.state.settings(),
        now,
      ),
      'application/json',
    );
    await this.state.recordBackupExported(now);
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const text = await file.text();
    const parsed = this.state.restoreFromBackupText(text);
    if (!parsed) return;
    const ok = await this.confirmDlg.confirm(
      'Replace what is on this device?',
      `The backup holds ${parsed.tasks.length} tasks and ${parsed.days.length} day records. They will replace everything saved here now.`,
      'Replace',
    );
    if (!ok) return;
    await this.state.applyRestoredBackup(parsed);
    void this.router.navigateByUrl('/');
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }

  async confirmErase(): Promise<void> {
    const ok = await this.confirmDlg.confirm(
      'Erase everything on this device?',
      'All tasks, habits, goals, focus sessions and settings here will be deleted. Backup files are not affected.',
      'Erase',
    );
    if (!ok) return;
    await this.state.eraseAllData();
    void this.router.navigateByUrl('/');
    if (typeof window !== 'undefined') window.scrollTo(0, 0);
  }
}
