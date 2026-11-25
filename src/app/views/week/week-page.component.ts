import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { dayName, shortDate } from '../../kit/dates';
import {
  addDays,
  dayLoad,
  formatDuration,
  mondayOf,
  sortTasksForDay,
  weekDates,
  weekPlanId,
} from '../../domain/logic';
import type { TaskItem } from '../../domain/models';
import { PlannerStateService } from '../../services/planner-state.service';

@Component({
  selector: 'dp-week-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Previous week"
        (click)="shiftWeek(-7)"
      >
        ←
      </button>
      <div class="text-center min-w-0">
        <h1 class="text-xl font-bold tracking-tight m-0">{{ weekHeading() }}</h1>
        @if (state.weekMonday() !== currentMonday()) {
          <button type="button" class="link text-xs opacity-80" (click)="jumpThisWeek()">
            This week →
          </button>
        }
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Next week"
        (click)="shiftWeek(7)"
      >
        →
      </button>
    </div>

    <!-- Weekly Goals & Load Summary -->
    <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="week-goals">
      <div class="card-body p-4 gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-bold m-0">Weekly goals</h2>
          <span class="text-xs opacity-75">
            {{ weekTotals().done }}/{{ weekTotals().total }} tasks ·
            {{ formatDur(weekTotals().planned) }} planned
          </span>
        </div>

        @for (g of goals(); track g.id) {
          <div class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="checkbox checkbox-sm checkbox-primary"
              [checked]="g.done"
              [attr.aria-label]="'Toggle weekly goal ' + g.title"
              (change)="state.toggleGoal(planId(), g.id)"
            />
            <span class="flex-1 break-words" [class.line-through]="g.done" [class.opacity-60]="g.done">
              {{ g.title }}
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-xs opacity-65"
              [attr.aria-label]="'Delete weekly goal ' + g.title"
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
            placeholder="Add a weekly goal…"
            aria-label="New weekly goal"
            [value]="goalDraft()"
            (input)="goalDraft.set(asValue($event))"
          />
          <button type="submit" class="btn btn-outline btn-sm min-h-10">Add</button>
        </form>
      </div>
    </section>

    <!-- 7-Day Board -->
    <div class="week-grid">
      @for (col of columns(); track col.iso) {
        <section
          class="week-col"
          [class.is-today]="col.iso === state.today()"
          [class.drag-over]="dragTarget() === col.iso"
          [attr.data-week-day]="col.iso"
          (dragover)="onDragOver($event, col.iso)"
          (dragleave)="onDragLeave(col.iso)"
          (drop)="onDrop($event, col.iso)"
        >
          <div class="flex items-center justify-between gap-1">
            <button
              type="button"
              class="font-bold text-sm text-left bg-transparent border-0 p-0 cursor-pointer hover:underline"
              (click)="openInToday(col.iso)"
            >
              {{ col.label }}
            </button>
            <span
              class="text-xs"
              [class.text-warning]="col.load.overCapacity"
              [class.font-semibold]="col.load.overCapacity"
              [class.opacity-70]="!col.load.overCapacity"
            >
              {{ formatDur(col.load.plannedMin) }}
            </span>
          </div>

          <progress
            class="progress w-full h-1.5"
            [class.progress-warning]="col.load.overCapacity"
            [class.progress-primary]="!col.load.overCapacity"
            [value]="col.load.plannedMin"
            [max]="state.settings().dailyCapacityMin"
          ></progress>

          <div class="flex flex-col gap-1.5">
            @for (t of col.tasks; track t.id) {
              <div
                class="p-2 rounded-lg border border-base-300 bg-base-200/60 text-xs flex flex-col gap-1"
                [class.opacity-60]="t.done"
                [attr.data-week-task]="t.id"
                draggable="true"
                (dragstart)="onDragStart($event, t)"
                (dragend)="onDragEnd()"
              >
                <div class="flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    class="checkbox checkbox-xs checkbox-success mt-0.5"
                    [checked]="t.done"
                    [attr.aria-label]="'Complete ' + t.title"
                    (change)="state.toggleDone(t.id)"
                  />
                  <span class="flex-1 break-words font-medium" [class.line-through]="t.done">
                    @if (t.top3) {
                      <span class="text-warning">★ </span>
                    }
                    {{ t.title }}
                  </span>
                </div>

                <div class="flex items-center justify-between gap-1 opacity-75">
                  <span>
                    @if (t.startTime) {
                      {{ t.startTime }} ·
                    }
                    {{ formatDur(t.durationMin) }}
                  </span>
                  <div class="flex items-center gap-0.5">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs px-1 min-h-6 h-6"
                      [attr.aria-label]="'Move ' + t.title + ' earlier'"
                      (click)="shiftTaskDay(t, -1)"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs px-1 min-h-6 h-6"
                      [attr.aria-label]="'Move ' + t.title + ' later'"
                      (click)="shiftTaskDay(t, 1)"
                    >
                      →
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>

          <form class="flex gap-1 mt-auto pt-1" (submit)="addDayTask($event, col.iso)">
            <input
              type="text"
              class="input input-bordered input-xs flex-1 min-h-8"
              placeholder="+ Task"
              [attr.aria-label]="'Add task on ' + col.label"
              [value]="dayDrafts()[col.iso] ?? ''"
              (input)="setDayDraft(col.iso, asValue($event))"
            />
          </form>
        </section>
      }
    </div>
  `,
})
export class WeekPageComponent {
  readonly state = inject(PlannerStateService);
  private readonly router = inject(Router);

  readonly goalDraft = signal('');
  readonly dayDrafts = signal<Record<string, string>>({});
  readonly draggingId = signal<string | null>(null);
  readonly dragTarget = signal<string | null>(null);

  readonly currentMonday = computed(() => mondayOf(this.state.today()));
  readonly planId = computed(() => weekPlanId(this.state.weekMonday()));
  readonly goals = computed(() => this.state.plans()[this.planId()]?.goals ?? []);

  readonly weekHeading = computed(() => {
    const start = this.state.weekMonday();
    const end = addDays(start, 6);
    return `${shortDate(start)} – ${shortDate(end)}`;
  });

  readonly columns = computed(() => {
    const dates = weekDates(this.state.weekMonday());
    const byDate = this.state.tasksByDate();
    const days = this.state.days();
    const cap = this.state.settings().dailyCapacityMin;
    return dates.map(iso => {
      const tasks = sortTasksForDay(byDate[iso] ?? []);
      return {
        iso,
        label: dayName(iso),
        tasks,
        load: dayLoad(tasks, days[iso], cap),
      };
    });
  });

  readonly weekTotals = computed(() => {
    let total = 0;
    let done = 0;
    let planned = 0;
    for (const c of this.columns()) {
      total += c.load.totalCount;
      done += c.load.doneCount;
      planned += c.load.plannedMin;
    }
    return { total, done, planned };
  });

  formatDur(min: number): string {
    return formatDuration(min);
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  shiftWeek(deltaDays: number): void {
    this.state.weekMonday.set(addDays(this.state.weekMonday(), deltaDays));
  }

  jumpThisWeek(): void {
    this.state.weekMonday.set(this.currentMonday());
  }

  openInToday(iso: string): void {
    this.state.openDate(iso);
    void this.router.navigateByUrl('/');
  }

  async addGoal(event: Event): Promise<void> {
    event.preventDefault();
    const val = this.goalDraft().trim();
    if (!val) return;
    await this.state.addGoal(this.planId(), val);
    this.goalDraft.set('');
  }

  setDayDraft(iso: string, val: string): void {
    this.dayDrafts.update(m => ({ ...m, [iso]: val }));
  }

  async addDayTask(event: Event, iso: string): Promise<void> {
    event.preventDefault();
    const title = (this.dayDrafts()[iso] ?? '').trim();
    if (!title) return;
    const created = await this.state.addTask({ title, date: iso });
    if (created) this.setDayDraft(iso, '');
  }

  shiftTaskDay(task: TaskItem, delta: number): void {
    void this.state.moveTask(task.id, addDays(task.date, delta));
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
