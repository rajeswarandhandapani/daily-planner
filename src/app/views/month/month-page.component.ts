import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { longDate } from '../../kit/dates';
import {
  formatDuration,
  monthGridDates,
  monthKey,
  monthPlanId,
  shiftMonth,
  sortTasksForDay,
} from '../../domain/logic';
import type { TaskItem } from '../../domain/models';
import { PlannerStateService } from '../../services/planner-state.service';

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

@Component({
  selector: 'dp-month-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Previous month"
        (click)="moveMonth(-1)"
      >
        ←
      </button>
      <div class="text-center min-w-0">
        <h1 class="text-xl font-bold tracking-tight m-0">{{ monthHeading() }}</h1>
        @if (state.month() !== currentMonth()) {
          <button type="button" class="link text-xs opacity-80" (click)="jumpCurrentMonth()">
            This month →
          </button>
        }
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Next month"
        (click)="moveMonth(1)"
      >
        →
      </button>
    </div>

    <!-- Monthly Goals -->
    <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="month-goals">
      <div class="card-body p-4 gap-3">
        <h2 class="text-base font-bold m-0">Monthly goals</h2>
        @for (g of goals(); track g.id) {
          <div class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-primary"
              [checked]="g.done"
              [attr.aria-label]="'Toggle monthly goal ' + g.title"
              (change)="state.toggleGoal(planId(), g.id)"
            />
            <span class="flex-1 break-words" [class.line-through]="g.done" [class.opacity-60]="g.done">
              {{ g.title }}
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-xs opacity-65"
              [attr.aria-label]="'Delete monthly goal ' + g.title"
              (click)="state.deleteGoal(planId(), g.id)"
            >
              ×
            </button>
          </div>
        }
        <form class="flex gap-2" (submit)="addGoal($event)">
          <input
            type="text"
            class="input input-bordered input-sm flex-1 min-h-10"
            placeholder="Add a monthly milestone…"
            aria-label="New monthly goal"
            [value]="goalDraft()"
            (input)="goalDraft.set(asValue($event))"
          />
          <button type="submit" class="btn btn-outline btn-sm min-h-10">Add</button>
        </form>
      </div>
    </section>

    <!-- Calendar Grid -->
    <section class="flex flex-col gap-1.5">
      <div class="month-grid text-center text-xs font-semibold opacity-65">
        @for (w of weekdays; track w) {
          <div>{{ w }}</div>
        }
      </div>

      <div class="month-grid">
        @for (c of cells(); track c.iso) {
          <button
            type="button"
            class="month-cell"
            [class.outside]="!c.inMonth"
            [class.is-today]="c.iso === state.today()"
            [class.selected]="c.iso === selectedIso()"
            [class.drag-over]="dragTarget() === c.iso"
            [attr.data-month-day]="c.iso"
            [attr.aria-label]="c.ariaLabel"
            (click)="selectDay(c.iso)"
            (dragover)="onDragOver($event, c.iso)"
            (dragleave)="onDragLeave(c.iso)"
            (drop)="onDrop($event, c.iso)"
          >
            <div class="flex items-center justify-between w-full gap-1">
              <span class="text-xs font-bold">{{ c.dayNum }}</span>
              <div class="flex items-center gap-0.5 text-[10px]">
                @if (c.hasTop3) {
                  <span class="text-warning">★</span>
                }
                @if (c.hasHabits) {
                  <span class="text-success">●</span>
                }
              </div>
            </div>

            @if (c.tasks.length > 0) {
              <div class="text-[10px] opacity-70 sm:hidden">
                {{ c.doneCount }}/{{ c.tasks.length }}
              </div>
              <div class="month-pills flex flex-col gap-0.5 w-full">
                @for (t of c.tasks.slice(0, 2); track t.id) {
                  <span class="month-pill" [class.line-through]="t.done">
                    {{ t.title }}
                  </span>
                }
                @if (c.tasks.length > 2) {
                  <span class="text-[10px] opacity-65">+{{ c.tasks.length - 2 }} more</span>
                }
              </div>
            }
          </button>
        }
      </div>
    </section>

    <!-- Selected Day Inspector -->
    <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="month-inspector">
      <div class="card-body p-4 gap-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-base font-bold m-0">{{ selectedHeading() }}</h2>
          <button
            type="button"
            class="btn btn-primary btn-xs min-h-8"
            (click)="openDayInToday()"
          >
            Open day →
          </button>
        </div>

        @if (selectedTasks().length === 0) {
          <p class="text-sm opacity-70 m-0">No tasks on this date.</p>
        } @else {
          <div class="flex flex-col gap-2">
            @for (t of selectedTasks(); track t.id) {
              <div
                class="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg border border-base-300"
                draggable="true"
                (dragstart)="onDragStart($event, t)"
                (dragend)="onDragEnd()"
              >
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-sm checkbox-success"
                    [checked]="t.done"
                    [attr.aria-label]="'Complete ' + t.title"
                    (change)="state.toggleDone(t.id)"
                  />
                  <span class="text-sm truncate" [class.line-through]="t.done">
                    @if (t.top3) {
                      <span class="text-warning">★ </span>
                    }
                    {{ t.title }}
                  </span>
                  <span class="text-xs opacity-65">{{ formatDur(t.durationMin) }}</span>
                </div>

                <label class="flex items-center gap-1 text-xs">
                  <span class="opacity-70">Move</span>
                  <input
                    type="date"
                    class="input input-bordered input-xs w-auto"
                    [attr.aria-label]="'Move ' + t.title + ' to date'"
                    [value]="t.date"
                    (change)="onMoveTaskDate(t, $event)"
                  />
                </label>
              </div>
            }
          </div>
        }

        <form class="flex gap-2" (submit)="addTaskToSelected($event)">
          <input
            type="text"
            class="input input-bordered input-sm flex-1 min-h-10"
            placeholder="Add task on this date…"
            aria-label="Add task on selected date"
            [value]="taskDraft()"
            (input)="taskDraft.set(asValue($event))"
          />
          <button type="submit" class="btn btn-outline btn-sm min-h-10">Add</button>
        </form>
      </div>
    </section>
  `,
})
export class MonthPageComponent {
  readonly state = inject(PlannerStateService);
  private readonly router = inject(Router);

  readonly weekdays = WEEKDAY_HEADERS;
  readonly goalDraft = signal('');
  readonly taskDraft = signal('');
  readonly selectedIso = signal(this.state.selectedDate());
  readonly draggingId = signal<string | null>(null);
  readonly dragTarget = signal<string | null>(null);

  readonly currentMonth = computed(() => monthKey(this.state.today()));
  readonly planId = computed(() => monthPlanId(this.state.month()));
  readonly goals = computed(() => this.state.plans()[this.planId()]?.goals ?? []);

  readonly monthHeading = computed(() => {
    const [y, m] = this.state.month().split('-').map(Number);
    return MONTH_FMT.format(new Date(y, m - 1, 1, 12));
  });

  readonly cells = computed(() => {
    const ym = this.state.month();
    const byDate = this.state.tasksByDate();
    const days = this.state.days();
    return monthGridDates(ym).map(iso => {
      const tasks = sortTasksForDay(byDate[iso] ?? []);
      const doneCount = tasks.filter(t => t.done).length;
      const hasTop3 = tasks.some(t => t.top3);
      const hasHabits = Object.values(days[iso]?.habits ?? {}).some(Boolean);
      return {
        iso,
        dayNum: Number(iso.slice(8, 10)),
        inMonth: iso.startsWith(ym),
        tasks,
        doneCount,
        hasTop3,
        hasHabits,
        ariaLabel: `${longDate(iso)}, ${tasks.length} tasks`,
      };
    });
  });

  readonly selectedHeading = computed(() => longDate(this.selectedIso()));
  readonly selectedTasks = computed(() =>
    sortTasksForDay(this.state.tasksByDate()[this.selectedIso()] ?? []),
  );

  formatDur(min: number): string {
    return formatDuration(min);
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  moveMonth(delta: number): void {
    const next = shiftMonth(this.state.month(), delta);
    this.state.month.set(next);
    this.selectedIso.set(`${next}-01`);
  }

  jumpCurrentMonth(): void {
    this.state.month.set(this.currentMonth());
    this.selectedIso.set(this.state.today());
  }

  selectDay(iso: string): void {
    this.selectedIso.set(iso);
  }

  openDayInToday(): void {
    this.state.openDate(this.selectedIso());
    void this.router.navigateByUrl('/');
  }

  async addGoal(event: Event): Promise<void> {
    event.preventDefault();
    const val = this.goalDraft().trim();
    if (!val) return;
    await this.state.addGoal(this.planId(), val);
    this.goalDraft.set('');
  }

  async addTaskToSelected(event: Event): Promise<void> {
    event.preventDefault();
    const val = this.taskDraft().trim();
    if (!val) return;
    const created = await this.state.addTask({ title: val, date: this.selectedIso() });
    if (created) this.taskDraft.set('');
  }

  onMoveTaskDate(task: TaskItem, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (val) void this.state.moveTask(task.id, val);
  }

  onDragStart(event: DragEvent, task: TaskItem): void {
    this.draggingId.set(task.id);
    event.dataTransfer?.setData('text/plain', task.id);
  }

  onDragEnd(): void {
    this.draggingId.set(null);
    this.dragTarget.set(null);
  }

  onDragOver(event: DragEvent, iso: string): void {
    event.preventDefault();
    this.dragTarget.set(iso);
  }

  onDragLeave(iso: string): void {
    if (this.dragTarget() === iso) this.dragTarget.set(null);
  }

  onDrop(event: DragEvent, iso: string): void {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain') || this.draggingId();
    this.draggingId.set(null);
    this.dragTarget.set(null);
    if (id) void this.state.moveTask(id, iso);
  }
}
