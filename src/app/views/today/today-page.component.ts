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
  dayStatus,
  detectConflicts,
  formatDuration,
  groupTasksByCategory,
  mondayOf,
  sortTasksByPriority,
  tasksForDayView,
  timelineRange,
  weekDates,
} from '../../domain/logic';
import { CATEGORIES, type CategoryId, type TaskItem } from '../../domain/models';
import { PlannerStateService } from '../../services/planner-state.service';
import { HabitStripComponent } from './habit-strip.component';
import { QuickAddComponent } from './quick-add.component';
import { TaskCardComponent } from './task-card.component';

@Component({
  selector: 'dp-today-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [QuickAddComponent, TaskCardComponent, HabitStripComponent],
  template: `
    <div class="flex items-center justify-center gap-3">
      <button
        type="button"
        class="btn btn-outline btn-xs min-h-8 w-8 px-0"
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
        class="btn btn-outline btn-xs min-h-8 w-8 px-0"
        aria-label="Next day"
        (click)="shiftDay(1)"
      >
        →
      </button>
    </div>

    <!-- 7-day strip with day numbers -->
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
          <span class="flex flex-col items-center leading-tight">
            <span class="text-[10px] opacity-75">{{ d.letter }}</span>
            <span class="text-xs font-bold">{{ d.dayNum }}</span>
          </span>
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

    <!-- Quick Add -->
    <dp-quick-add #quickAdd [selectedDate]="state.selectedDate()" />

    <!-- Daily Plan -->
    <div class="flex items-center justify-between gap-2">
      <h2 class="text-base font-bold m-0">Daily plan</h2>
      <div class="seg" role="group" aria-label="Schedule view">
        <button
          type="button"
          [attr.aria-pressed]="'' + (state.todayMode() === 'grouped')"
          (click)="state.setTodayMode('grouped')"
        >
          By Category
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

    @if (visibleTasks().length === 0) {
      <div class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-5 text-center text-sm opacity-75">
          @if (state.bucket().length > 0) {
            No tasks scheduled for {{ pullTargetLabel() }} yet. Select tasks in your Unfinished bucket below and pull them into {{ pullTargetLabel() }}.
          } @else {
            No tasks planned for {{ pullTargetLabel() }} yet. Add a task above (leave Date blank for your Unfinished bucket, or set a date).
          }
        </div>
      </div>
    } @else if (state.todayMode() === 'grouped') {
      @for (group of categoryGroups(); track group.category.id) {
        <section class="flex flex-col gap-2" [attr.data-category]="group.category.id">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 m-0">
              <i class="cat-dot" [style.background]="'var(' + group.category.colorVar + ')'"></i>
              <span>{{ group.category.label }}</span>
            </h3>
            <span class="text-xs opacity-65">{{ group.doneCount }}/{{ group.totalCount }}</span>
          </div>
          @for (t of group.tasks; track t.id) {
            <dp-task-card [task]="t" [conflict]="conflicts().has(t.id)" />
          }
        </section>
      }
    } @else {
      <!-- Adaptive Timeline View -->
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

      @if (untimedGroups().length > 0) {
        <div class="flex flex-col gap-3">
          <h3 class="text-xs font-bold uppercase tracking-wide opacity-65 m-0">Untimed</h3>
          @for (group of untimedGroups(); track group.category.id) {
            <section class="flex flex-col gap-2" [attr.data-category]="group.category.id">
              <div class="flex items-center justify-between gap-2">
                <h4 class="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 m-0">
                  <i class="cat-dot" [style.background]="'var(' + group.category.colorVar + ')'"></i>
                  <span>{{ group.category.label }}</span>
                </h4>
                <span class="text-xs opacity-65">{{ group.doneCount }}/{{ group.totalCount }}</span>
              </div>
              @for (t of group.tasks; track t.id) {
                <dp-task-card [task]="t" [conflict]="false" />
              }
            </section>
          }
        </div>
      }
    }

    <!-- Unfinished Bucket (grouped by category & priority; multi-select pull into Daily plan) -->
    @if (state.bucket().length > 0) {
      <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="bucket-panel">
        <div class="card-body p-3 gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              class="flex items-center gap-2 text-left bg-transparent border-0 p-0 cursor-pointer font-bold text-sm"
              [attr.aria-expanded]="'' + isBucketExpanded()"
              (click)="toggleBucket()"
            >
              <span>{{ isBucketExpanded() ? '▾' : '▸' }} Unfinished bucket</span>
              <span class="badge badge-sm badge-ghost">{{ state.bucket().length }}</span>
            </button>

            <div class="flex items-center gap-1.5">
              @if (isBucketExpanded() && pullableBucketIds().length > 1) {
                <button
                  type="button"
                  class="btn btn-ghost btn-xs"
                  [attr.aria-label]="allPullableSelected() ? 'Clear bucket selection' : 'Select all bucket tasks'"
                  (click)="toggleSelectAllBucket()"
                >
                  {{ allPullableSelected() ? 'Clear' : 'Select all' }}
                </button>
              }
              @if (selectedBucketCount() > 0) {
                <button
                  type="button"
                  class="btn btn-primary btn-xs min-h-8"
                  data-testid="pull-selected-btn"
                  (click)="pullSelected()"
                >
                  + Pull selected ({{ selectedBucketCount() }})
                </button>
              } @else {
                <span class="text-xs opacity-65">Pull into {{ pullTargetLabel() }}</span>
              }
            </div>
          </div>

          @if (isBucketExpanded()) {
            @if (bucketCategories().length > 1) {
              <div class="flex flex-wrap gap-1">
                <button
                  type="button"
                  class="btn btn-xs btn-outline chip-btn"
                  [attr.aria-pressed]="'' + (bucketFilter() === 'all')"
                  (click)="bucketFilter.set('all')"
                >
                  All
                </button>
                @for (cat of bucketCategories(); track cat.id) {
                  <button
                    type="button"
                    class="btn btn-xs btn-outline chip-btn gap-1"
                    [attr.aria-pressed]="'' + (bucketFilter() === cat.id)"
                    (click)="bucketFilter.set(cat.id)"
                  >
                    <i class="cat-dot" [style.background]="'var(' + cat.colorVar + ')'"></i>
                    {{ cat.label }}
                  </button>
                }
              </div>
            }

            <div class="flex flex-col gap-3">
              @for (group of bucketCategoryGroups(); track group.category.id) {
                <div class="flex flex-col gap-1.5" [attr.data-bucket-category]="group.category.id">
                  <div class="flex items-center justify-between gap-2">
                    <h3 class="text-xs font-bold uppercase tracking-wide flex items-center gap-1.5 m-0">
                      <i class="cat-dot" [style.background]="'var(' + group.category.colorVar + ')'"></i>
                      <span>{{ group.category.label }}</span>
                    </h3>
                    <span class="text-xs opacity-65">{{ group.totalCount }}</span>
                  </div>

                  @for (t of group.tasks; track t.id) {
                    <div
                      class="p-2.5 rounded-lg cat-tint flex items-center justify-between gap-2"
                      [attr.data-bucket-task]="t.id"
                      [attr.data-cat]="t.category"
                    >
                      <div class="flex items-start gap-2 min-w-0 flex-1">
                        <input
                          type="checkbox"
                          class="checkbox checkbox-sm checkbox-primary mt-0.5 flex-none"
                          [checked]="selectedBucketIds().has(t.id)"
                          [disabled]="pulledOnSelectedDate().has(t.id)"
                          [attr.aria-label]="'Select ' + t.title + ' to pull'"
                          (change)="toggleBucketSelection(t.id)"
                        />
                        <div class="min-w-0 flex-1">
                          <div class="text-sm font-semibold leading-snug break-words">{{ t.title }}</div>
                          <div class="flex flex-wrap items-center gap-1.5 mt-0.5 text-xs opacity-80">
                            @if (t.top3) {
                              <span class="badge badge-warning badge-xs">Top 3</span>
                            }
                            @if (t.priority === 'high') {
                              <span class="badge badge-error badge-outline badge-xs">High</span>
                            }
                            <span class="badge badge-ghost badge-xs">{{ formatDur(t.durationMin) }}</span>
                            @if (t.subtasks.length > 0) {
                              <span>{{ doneSubCount(t) }}/{{ t.subtasks.length }} steps</span>
                            }
                            @if (focusedOf(t.id) > 0) {
                              <span class="badge badge-primary badge-outline badge-xs" data-testid="bucket-focused-badge">
                                {{ focusedOf(t.id) }}m focused
                              </span>
                            }
                          </div>
                        </div>
                      </div>

                      <div class="flex items-center gap-1 flex-none">
                        @if (pulledOnSelectedDate().has(t.id)) {
                          <span class="badge badge-success badge-outline badge-xs" data-testid="in-plan-badge">
                            In plan
                          </span>
                        } @else {
                          <button
                            type="button"
                            class="btn btn-primary btn-xs min-h-8"
                            [attr.aria-label]="'Pull ' + t.title + ' into plan'"
                            (click)="pullOne(t.id)"
                          >
                            + Pull
                          </button>
                        }
                        <button
                          type="button"
                          class="btn btn-outline btn-xs min-h-8 px-2"
                          [attr.aria-label]="'Finish ' + t.title + ' in bucket'"
                          title="Mark finished in bucket"
                          (click)="state.toggleDone(t.id)"
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs opacity-65 px-1.5"
                          [attr.aria-label]="'Delete ' + t.title"
                          (click)="state.deleteTask(t.id)"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          }
        </div>
      </section>
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
  readonly isBucketExpanded = signal(true);
  readonly bucketFilter = signal<CategoryId | 'all'>('all');
  readonly selectedBucketIds = signal<Set<string>>(new Set());

  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private noteDate = '';

  readonly heading = computed(() => {
    const iso = this.state.selectedDate();
    return iso === this.state.today() ? `Today, ${shortDate(iso)}` : longDate(iso);
  });

  readonly pullTargetLabel = computed(() =>
    this.state.selectedDate() === this.state.today()
      ? 'Today'
      : shortDate(this.state.selectedDate()),
  );

  readonly stripDays = computed(() => {
    const monday = mondayOf(this.state.selectedDate());
    const byDate = this.state.tasksByDate();
    return weekDates(monday).map(iso => ({
      iso,
      letter: dayLetter(iso),
      dayNum: Number(iso.slice(8, 10)),
      label: longDate(iso),
      status: dayStatus(byDate[iso] ?? []),
    }));
  });

  readonly visibleTasks = computed(() =>
    sortTasksByPriority(tasksForDayView(this.state.tasks(), this.state.selectedDate())),
  );

  readonly pulledOnSelectedDate = computed(() => {
    const ids = new Set<string>();
    for (const t of this.visibleTasks()) {
      if (!t.done && t.sourceTaskId) ids.add(t.sourceTaskId);
    }
    return ids;
  });

  readonly bucketCategories = computed(() => {
    const present = new Set(this.state.bucket().map(t => t.category));
    return CATEGORIES.filter(c => present.has(c.id));
  });

  readonly filteredBucket = computed(() => {
    const f = this.bucketFilter();
    const all = this.state.bucket();
    if (f === 'all') return all;
    const matched = all.filter(t => t.category === f);
    return matched.length > 0 ? matched : all;
  });

  readonly bucketCategoryGroups = computed(() => groupTasksByCategory(this.filteredBucket()));

  readonly pullableBucketIds = computed(() => {
    const pulled = this.pulledOnSelectedDate();
    return this.filteredBucket()
      .filter(t => !pulled.has(t.id))
      .map(t => t.id);
  });

  readonly selectedBucketCount = computed(() => {
    const pullable = new Set(this.pullableBucketIds());
    let count = 0;
    for (const id of this.selectedBucketIds()) {
      if (pullable.has(id)) count += 1;
    }
    return count;
  });

  readonly allPullableSelected = computed(() => {
    const ids = this.pullableBucketIds();
    return ids.length > 0 && ids.every(id => this.selectedBucketIds().has(id));
  });

  readonly categoryGroups = computed(() => groupTasksByCategory(this.visibleTasks()));
  readonly conflicts = computed(() => detectConflicts(this.visibleTasks()));

  readonly load = computed(() =>
    dayLoad(
      this.visibleTasks(),
      this.state.days()[this.state.selectedDate()],
      this.state.settings().dailyCapacityMin,
    ),
  );

  readonly timelineHours = computed(() => {
    const timed = this.visibleTasks().filter(t => t.startTime !== null);
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

  readonly untimedGroups = computed(() =>
    groupTasksByCategory(this.visibleTasks().filter(t => t.startTime === null)),
  );

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

  doneSubCount(t: TaskItem): number {
    return t.subtasks.filter(s => s.done).length;
  }

  focusedOf(taskId: string): number {
    return this.state.focusMinutesByTask()[taskId] ?? 0;
  }

  toggleBucket(): void {
    this.isBucketExpanded.update(open => !open);
  }

  toggleBucketSelection(id: string): void {
    this.selectedBucketIds.update(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  toggleSelectAllBucket(): void {
    const ids = this.pullableBucketIds();
    if (this.allPullableSelected()) {
      this.selectedBucketIds.set(new Set());
    } else {
      this.selectedBucketIds.set(new Set(ids));
    }
  }

  pullOne(id: string): void {
    this.selectedBucketIds.update(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    void this.state.pullToDate(id, this.state.selectedDate());
  }

  pullSelected(): void {
    const pullable = new Set(this.pullableBucketIds());
    const ids = [...this.selectedBucketIds()].filter(id => pullable.has(id));
    if (!ids.length) return;
    this.selectedBucketIds.set(new Set());
    void this.state.pullManyToDate(ids, this.state.selectedDate());
  }

  shiftDay(delta: number): void {
    this.flushNote();
    this.state.openDate(addDays(this.state.selectedDate(), delta));
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
