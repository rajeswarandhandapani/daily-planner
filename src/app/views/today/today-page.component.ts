import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { dayLetter, longDate, shortDate } from '../../kit/dates';
import {
  addDays,
  dayLoad,
  dayPartOf,
  dayStatus,
  detectConflicts,
  formatDuration,
  mondayOf,
  nextMonday,
  sortTasksForDay,
  timelineRange,
  weekDates,
} from '../../domain/logic';
import type { DayPart, TaskItem } from '../../domain/models';
import { PlannerStateService } from '../../services/planner-state.service';
import { HabitStripComponent } from './habit-strip.component';
import { QuickAddComponent } from './quick-add.component';
import { TaskCardComponent } from './task-card.component';

const DAY_PARTS: readonly { id: DayPart; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
  { id: 'anytime', label: 'Anytime' },
];

@Component({
  selector: 'dp-today-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuickAddComponent, TaskCardComponent, HabitStripComponent],
  template: `
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Previous day"
        (click)="shiftDay(-1)"
      >
        ←
      </button>
      <div class="text-center min-w-0">
        <h1 class="text-xl font-bold tracking-tight m-0 truncate">{{ heading() }}</h1>
        @if (state.selectedDate() !== state.today()) {
          <button
            type="button"
            class="link text-xs opacity-80"
            (click)="state.openDate(state.today())"
          >
            Back to today →
          </button>
        }
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Next day"
        (click)="shiftDay(1)"
      >
        →
      </button>
    </div>

    <!-- 7-day strip -->
    <div class="strip" role="group" aria-label="This week">
      @for (d of stripDays(); track d.iso) {
        <button
          type="button"
          class="cell"
          [attr.data-date]="d.iso"
          [attr.data-s]="d.status"
          [class.is-today]="d.iso === state.today()"
          [class.selected]="d.iso === state.selectedDate()"
          [attr.aria-label]="d.label"
          (click)="state.openDate(d.iso)"
        >
          <span>{{ d.letter }}</span>
        </button>
      }
    </div>

    <!-- Daily capacity & summary bar -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-3 gap-1.5">
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span data-testid="day-load">
            Planned <b>{{ formatDur(load().plannedMin) }}</b> / {{ formatDur(state.settings().dailyCapacityMin) }}
            @if (load().overCapacity) {
              <span class="text-warning font-semibold"> · Over capacity</span>
            }
          </span>
          <span data-testid="day-stats">
            {{ load().doneCount }} of {{ load().totalCount }} done
            @if (load().focusedMin > 0) {
              · <b>{{ load().focusedMin }}m focused</b>
            }
          </span>
        </div>
        <progress
          class="progress w-full h-2"
          [class.progress-warning]="load().overCapacity"
          [class.progress-primary]="!load().overCapacity"
          [value]="load().plannedMin"
          [max]="state.settings().dailyCapacityMin"
        ></progress>
      </div>
    </section>

    <!-- Overdue rollover banner -->
    @if (state.overdue().length > 0) {
      <section
        class="card bg-warning/10 border border-warning/40 shadow-xs"
        data-testid="rollover-banner"
      >
        <div class="card-body p-3 gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold">
              {{ state.overdue().length }} unfinished
              {{ state.overdue().length === 1 ? 'task' : 'tasks' }} from earlier
            </span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              type="button"
              class="btn btn-warning btn-xs min-h-8"
              (click)="rollAll(state.today())"
            >
              Move all to today
            </button>
            <button
              type="button"
              class="btn btn-outline btn-xs min-h-8"
              (click)="rollAll(tomorrowIso())"
            >
              Tomorrow
            </button>
            <button
              type="button"
              class="btn btn-outline btn-xs min-h-8"
              (click)="rollAll(nextMonIso())"
            >
              Next Monday
            </button>
          </div>
        </div>
      </section>
    }

    <!-- Quick Add -->
    <dp-quick-add #quickAdd [date]="state.selectedDate()" />

    <!-- Top 3 Priorities -->
    @if (top3Tasks().length > 0) {
      <section class="flex flex-col gap-2" data-testid="top3-section">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-bold uppercase tracking-wide opacity-75 m-0">
            ★ Top 3 Priorities ({{ top3Tasks().length }}/3)
          </h2>
        </div>
        @for (t of top3Tasks(); track t.id) {
          <dp-task-card [task]="t" [conflict]="conflicts().has(t.id)" />
        }
      </section>
    }

    <!-- Schedule mode toggle -->
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-base font-bold m-0">Schedule</h2>
      <div class="seg" role="group" aria-label="Schedule view">
        <button
          type="button"
          [attr.aria-pressed]="'' + (state.todayMode() === 'grouped')"
          (click)="state.setTodayMode('grouped')"
        >
          Grouped
        </button>
        <button
          type="button"
          [attr.aria-pressed]="'' + (state.todayMode() === 'timeline')"
          (click)="state.setTodayMode('timeline')"
        >
          Timeline
        </button>
      </div>
    </div>

    @if (dayTasks().length === 0) {
      <div class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-5 text-center text-sm opacity-75">
          No tasks planned for this day yet. Add one above to get started.
        </div>
      </div>
    } @else if (state.todayMode() === 'grouped') {
      @for (group of groupedSections(); track group.id) {
        @if (group.tasks.length > 0) {
          <section class="flex flex-col gap-2" [attr.data-group]="group.id">
            <h3 class="text-xs font-bold uppercase tracking-wide opacity-65 m-0">
              {{ group.label }}
            </h3>
            @for (t of group.tasks; track t.id) {
              <dp-task-card [task]="t" [conflict]="conflicts().has(t.id)" />
            }
          </section>
        }
      }
    } @else {
      <!-- Timeline View -->
      <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="timeline-view">
        <div class="card-body p-3 gap-0">
          @for (slot of timelineHours(); track slot.hour) {
            <div class="timeline-row">
              <span class="timeline-hour">{{ slot.label }}</span>
              <div class="flex flex-col gap-2 min-w-0">
                @for (t of slot.tasks; track t.id) {
                  <dp-task-card [task]="t" [conflict]="conflicts().has(t.id)" />
                }
              </div>
            </div>
          }
        </div>
      </section>

      @if (untimedTasks().length > 0) {
        <section class="flex flex-col gap-2">
          <h3 class="text-xs font-bold uppercase tracking-wide opacity-65 m-0">Untimed</h3>
          @for (t of untimedTasks(); track t.id) {
            <dp-task-card [task]="t" [conflict]="false" />
          }
        </section>
      }
    }

    <!-- Daily Habits -->
    <dp-habit-strip [date]="state.selectedDate()" />

    <!-- Daily Note -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-2">
        <div class="flex items-center justify-between gap-2">
          <label for="day-note" class="text-base font-bold">Daily note</label>
          <span class="text-xs opacity-65" data-testid="note-status">{{ noteStatus() }}</span>
        </div>
        <textarea
          id="day-note"
          rows="3"
          class="textarea textarea-bordered w-full"
          placeholder="Wins, blockers, or shutdown notes for this day…"
          aria-label="Note for this day"
          [value]="noteDraft()"
          (input)="onNoteInput($event)"
          (blur)="flushNote()"
        ></textarea>
      </div>
    </section>
  `,
})
export class TodayPageComponent {
  readonly state = inject(PlannerStateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly quickAddRef = viewChild<QuickAddComponent>('quickAdd');

  readonly noteDraft = signal('');
  readonly noteStatus = signal('');
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private noteDate = '';

  readonly heading = computed(() => {
    const iso = this.state.selectedDate();
    return iso === this.state.today() ? `Today, ${shortDate(iso)}` : longDate(iso);
  });

  readonly stripDays = computed(() => {
    const monday = mondayOf(this.state.selectedDate());
    const byDate = this.state.tasksByDate();
    return weekDates(monday).map(iso => ({
      iso,
      letter: dayLetter(iso),
      label: longDate(iso),
      status: dayStatus(byDate[iso] ?? []),
    }));
  });

  readonly dayTasks = computed(() =>
    sortTasksForDay(this.state.tasksByDate()[this.state.selectedDate()] ?? []),
  );

  readonly top3Tasks = computed(() => this.dayTasks().filter(t => t.top3));
  readonly remainingTasks = computed(() => this.dayTasks().filter(t => !t.top3));
  readonly conflicts = computed(() => detectConflicts(this.dayTasks()));

  readonly load = computed(() =>
    dayLoad(
      this.dayTasks(),
      this.state.days()[this.state.selectedDate()],
      this.state.settings().dailyCapacityMin,
    ),
  );

  readonly groupedSections = computed(() => {
    const items = this.remainingTasks();
    return DAY_PARTS.map(part => ({
      id: part.id,
      label: part.label,
      tasks: items.filter(t => dayPartOf(t.startTime) === part.id),
    }));
  });

  readonly timelineHours = computed(() => {
    const timed = this.dayTasks().filter(t => t.startTime !== null);
    const { startHour, endHour } = timelineRange(timed);
    const byHour = new Map<number, TaskItem[]>();
    for (const t of timed) {
      const h = Number((t.startTime as string).slice(0, 2));
      const list = byHour.get(h) ?? [];
      list.push(t);
      byHour.set(h, list);
    }
    const rows: { hour: number; label: string; tasks: TaskItem[] }[] = [];
    for (let h = startHour; h < endHour; h++) {
      rows.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}:00`,
        tasks: byHour.get(h) ?? [],
      });
    }
    return rows;
  });

  readonly untimedTasks = computed(() => this.dayTasks().filter(t => t.startTime === null));
  readonly tomorrowIso = computed(() => addDays(this.state.today(), 1));
  readonly nextMonIso = computed(() => nextMonday(addDays(this.state.today(), 1)));

  constructor() {
    effect(() => {
      const iso = this.state.selectedDate();
      const saved = this.state.days()[iso]?.note ?? '';
      if (iso !== this.noteDate) {
        this.noteDate = iso;
        this.noteDraft.set(saved);
        this.noteStatus.set('');
      }
    });

    if (typeof document !== 'undefined') {
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        this.quickAddRef()?.focusInput();
      };
      document.addEventListener('keydown', onKey);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('keydown', onKey);
        if (this.noteTimer) clearTimeout(this.noteTimer);
      });
    }
  }

  formatDur(min: number): string {
    return formatDuration(min);
  }

  shiftDay(delta: number): void {
    this.flushNote();
    this.state.openDate(addDays(this.state.selectedDate(), delta));
  }

  rollAll(targetIso: string): void {
    const ids = this.state.overdue().map(t => t.id);
    void this.state.rolloverTasks(ids, targetIso);
  }

  onNoteInput(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.noteDraft.set(val);
    this.noteStatus.set('Saving…');
    if (this.noteTimer) clearTimeout(this.noteTimer);
    const date = this.state.selectedDate();
    this.noteTimer = setTimeout(() => {
      this.noteTimer = null;
      void this.state.saveDayNote(date, val).then(() => this.noteStatus.set('Saved'));
    }, 400);
  }

  flushNote(): void {
    if (!this.noteTimer) return;
    clearTimeout(this.noteTimer);
    this.noteTimer = null;
    const date = this.noteDate || this.state.selectedDate();
    void this.state.saveDayNote(date, this.noteDraft()).then(() => this.noteStatus.set('Saved'));
  }
}
