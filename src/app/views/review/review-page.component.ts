import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { barPath, niceScale, pointerIn } from '../../kit/chart-kit';
import { dayLetter, shortDate } from '../../kit/dates';
import {
  addDays,
  focusSeries,
  formatDuration,
  mondayOf,
  planningStreak,
  weekPlanId,
  weeklyReview,
} from '../../domain/logic';
import { PlannerStateService } from '../../services/planner-state.service';

@Component({
  selector: 'dp-review-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Previous review week"
        (click)="shiftWeek(-7)"
      >
        ←
      </button>
      <div class="text-center min-w-0">
        <h1 class="text-xl font-bold tracking-tight m-0">Weekly Review</h1>
        <p class="text-xs opacity-70 m-0">{{ weekRangeLabel() }}</p>
      </div>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-square min-h-10"
        aria-label="Next review week"
        (click)="shiftWeek(7)"
      >
        →
      </button>
    </div>

    <!-- KPI Grid -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      <div class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-3 gap-0.5">
          <span class="text-xs opacity-70">Streak</span>
          <b class="text-lg" data-testid="kpi-streak">{{ streak() }}d</b>
        </div>
      </div>
      <div class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-3 gap-0.5">
          <span class="text-xs opacity-70">Completion</span>
          <b class="text-lg" data-testid="kpi-completion">{{ review().completionPct }}%</b>
        </div>
      </div>
      <div class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-3 gap-0.5">
          <span class="text-xs opacity-70">Focused</span>
          <b class="text-lg" data-testid="kpi-focused">{{ formatDur(review().focusedMin) }}</b>
        </div>
      </div>
      <div class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-3 gap-0.5">
          <span class="text-xs opacity-70">Habits</span>
          <b class="text-lg" data-testid="kpi-habits">{{ review().habitPct }}%</b>
        </div>
      </div>
    </div>

    <!-- 14-Day SVG Focus vs Planned Chart -->
    <section class="card bg-base-100 border border-base-300 shadow-xs">
      <div class="card-body p-4 gap-2">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-base font-bold m-0">Focus vs. planned (14 days)</h2>
          <div class="flex items-center gap-3 text-xs opacity-75">
            <span class="inline-flex items-center gap-1">
              <i class="cat-dot" style="background: var(--dp-planned)"></i> Planned
            </span>
            <span class="inline-flex items-center gap-1">
              <i class="cat-dot" style="background: var(--dp-focus)"></i> Focused
            </span>
          </div>
        </div>

        <div class="chart-plot" (pointerleave)="tip.set(null)">
          <svg
            [attr.viewBox]="'0 0 ' + chartW + ' ' + chartH"
            role="img"
            aria-label="14-day focus and planned minutes bar chart"
            (pointermove)="onChartPointer($event)"
          >
            @for (tick of chartTicks(); track tick.y) {
              <line class="grid" [attr.x1]="padL" [attr.x2]="chartW - padR" [attr.y1]="tick.y" [attr.y2]="tick.y" />
              <text class="axis" [attr.x]="padL - 6" [attr.y]="tick.y + 4" text-anchor="end">
                {{ tick.label }}
              </text>
            }

            @if (capacityY(); as cy) {
              <line class="goal-line" [attr.x1]="padL" [attr.x2]="chartW - padR" [attr.y1]="cy" [attr.y2]="cy" />
            }

            @for (bar of chartBars(); track bar.date) {
              @if (bar.plannedPath) {
                <path class="bar-planned" [attr.d]="bar.plannedPath" />
              }
              @if (bar.focusPath) {
                <path class="bar-focus" [attr.d]="bar.focusPath" />
              }
              @if (bar.showLabel) {
                <text class="axis" [attr.x]="bar.cx" [attr.y]="chartH - 6" text-anchor="middle">
                  {{ bar.label }}
                </text>
              }
            }
          </svg>

          @if (tip(); as t) {
            <div class="chart-tip" [style.left.px]="t.x" [style.top.px]="t.y">
              <b>{{ t.label }}</b><br />
              Focused {{ formatDur(t.focusedMin) }} · Planned {{ formatDur(t.plannedMin) }}
            </div>
          }
        </div>
      </div>
    </section>

    <!-- Category Breakdown -->
    @if (review().categories.length > 0) {
      <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="category-breakdown">
        <div class="card-body p-4 gap-3">
          <h2 class="text-base font-bold m-0">By category</h2>
          @for (cat of review().categories; track cat.id) {
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between text-xs">
                <span class="inline-flex items-center gap-1.5 font-medium">
                  <i class="cat-dot" [style.background]="'var(' + cat.colorVar + ')'"></i>
                  {{ cat.label }}
                </span>
                <span class="opacity-75">
                  {{ cat.doneTasks }}/{{ cat.totalTasks }} done · {{ formatDur(cat.plannedMin) }}
                  @if (cat.focusedMin > 0) {
                    · {{ formatDur(cat.focusedMin) }} focused
                  }
                </span>
              </div>
              <div class="w-full h-2 rounded bg-base-200 overflow-hidden">
                <div
                  class="h-full rounded"
                  [style.width.%]="catWidth(cat.plannedMin)"
                  [style.background]="'var(' + cat.colorVar + ')'"
                ></div>
              </div>
            </div>
          }
        </div>
      </section>
    }

    <!-- Unfinished tasks rollover -->
    @if (review().unfinished.length > 0) {
      <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="review-unfinished">
        <div class="card-body p-4 gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-base font-bold m-0">
              Unfinished this week ({{ review().unfinished.length }})
            </h2>
            <button
              type="button"
              class="btn btn-outline btn-xs min-h-8"
              (click)="moveUnfinishedNextMonday()"
            >
              Move to next Monday
            </button>
          </div>
          <div class="flex flex-col gap-1.5 text-sm">
            @for (t of review().unfinished; track t.id) {
              <div class="flex items-center justify-between gap-2 py-1 border-t border-base-300 first-of-type:border-t-0">
                <span class="truncate">{{ t.title }}</span>
                <span class="text-xs opacity-65 flex-none">{{ formatShort(t.date) }}</span>
              </div>
            }
          </div>
        </div>
      </section>
    }

    <!-- 7-Day Habit Scorecard -->
    @if (review().habitRows.length > 0) {
      <section class="card bg-base-100 border border-base-300 shadow-xs">
        <div class="card-body p-4 gap-2">
          <h2 class="text-base font-bold m-0">Habit scorecard</h2>
          <div class="overflow-x-auto">
            <table class="table table-xs w-full">
              <thead>
                <tr>
                  <th>Habit</th>
                  @for (d of review().dates; track d) {
                    <th class="text-center">{{ letterOf(d) }}</th>
                  }
                  <th class="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                @for (row of review().habitRows; track row.habit.id) {
                  <tr>
                    <td class="font-medium">{{ row.habit.name }}</td>
                    @for (done of row.checks; track $index) {
                      <td class="text-center">{{ done ? '✓' : '·' }}</td>
                    }
                    <td class="text-right font-mono">{{ row.doneCount }}/7</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>
    }

    <!-- Weekly Reflection -->
    <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="weekly-reflection">
      <div class="card-body p-4 gap-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-base font-bold m-0">Weekly reflection</h2>
          <span class="text-xs opacity-65" data-testid="reflection-status">{{ reflStatus() }}</span>
        </div>

        <label class="flex flex-col gap-1">
          <span class="text-xs opacity-75">What went well?</span>
          <textarea
            rows="2"
            class="textarea textarea-bordered w-full"
            aria-label="What went well"
            [value]="wins()"
            (input)="onReflInput('wins', $event)"
            (blur)="flushRefl()"
          ></textarea>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs opacity-75">What slipped and why?</span>
          <textarea
            rows="2"
            class="textarea textarea-bordered w-full"
            aria-label="What slipped and why"
            [value]="slipped()"
            (input)="onReflInput('slipped', $event)"
            (blur)="flushRefl()"
          ></textarea>
        </label>

        <label class="flex flex-col gap-1">
          <span class="text-xs opacity-75">Top focus for next week</span>
          <textarea
            rows="2"
            class="textarea textarea-bordered w-full"
            aria-label="Top focus for next week"
            [value]="nextFocus()"
            (input)="onReflInput('nextFocus', $event)"
            (blur)="flushRefl()"
          ></textarea>
        </label>
      </div>
    </section>
  `,
})
export class ReviewPageComponent {
  readonly state = inject(PlannerStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly chartW = 560;
  readonly chartH = 190;
  readonly padL = 42;
  readonly padR = 12;
  readonly padT = 14;
  readonly padB = 24;

  readonly tip = signal<{ x: number; y: number; label: string; focusedMin: number; plannedMin: number } | null>(null);
  readonly wins = signal('');
  readonly slipped = signal('');
  readonly nextFocus = signal('');
  readonly reflStatus = signal('');

  private reflTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedPlanId = '';

  readonly planId = computed(() => weekPlanId(this.state.weekMonday()));
  readonly weekRangeLabel = computed(() => {
    const start = this.state.weekMonday();
    return `${shortDate(start)} – ${shortDate(addDays(start, 6))}`;
  });

  readonly streak = computed(() => planningStreak(this.state.tasks(), this.state.today()));

  readonly review = computed(() =>
    weeklyReview(
      this.state.tasks(),
      this.state.days(),
      this.state.weekMonday(),
      this.state.settings().habits,
    ),
  );

  readonly series = computed(() =>
    focusSeries(this.state.days(), this.state.tasks(), this.state.today(), 14),
  );

  readonly scale = computed(() => {
    const cap = this.state.settings().dailyCapacityMin;
    let peak = Math.max(60, cap);
    for (const p of this.series()) {
      peak = Math.max(peak, p.plannedMin, p.focusedMin);
    }
    return niceScale(peak);
  });

  readonly chartTicks = computed(() => {
    const { step, top } = this.scale();
    const plotH = this.chartH - this.padT - this.padB;
    const ticks: { y: number; label: string }[] = [];
    for (let v = 0; v <= top; v += step) {
      const y = this.padT + plotH * (1 - v / top);
      ticks.push({ y, label: formatDuration(v) });
    }
    return ticks;
  });

  readonly capacityY = computed(() => {
    const cap = this.state.settings().dailyCapacityMin;
    const { top } = this.scale();
    if (cap > top) return null;
    const plotH = this.chartH - this.padT - this.padB;
    return this.padT + plotH * (1 - cap / top);
  });

  readonly chartBars = computed(() => {
    const pts = this.series();
    const { top } = this.scale();
    const plotW = this.chartW - this.padL - this.padR;
    const plotH = this.chartH - this.padT - this.padB;
    const base = this.padT + plotH;
    const slotW = plotW / pts.length;
    const barW = Math.max(6, Math.min(20, slotW * 0.56));

    return pts.map((p, idx) => {
      const cx = this.padL + slotW * (idx + 0.5);
      const x = cx - barW / 2;
      const plannedY = base - (p.plannedMin / top) * plotH;
      const focusY = base - (p.focusedMin / top) * plotH;
      return {
        ...p,
        cx,
        label: shortDate(p.date).replace(/\s+/, ' '),
        showLabel: idx === 0 || idx === 6 || idx === pts.length - 1,
        plannedPath: p.plannedMin > 0 ? barPath(x, base, plannedY, barW, 3) : '',
        focusPath: p.focusedMin > 0 ? barPath(x, base, focusY, barW, 3) : '',
      };
    });
  });

  private readonly maxCatMin = computed(() =>
    Math.max(1, ...this.review().categories.map(c => c.plannedMin)),
  );

  constructor() {
    effect(() => {
      const id = this.planId();
      const refl = this.state.plans()[id]?.reflection;
      if (id !== this.loadedPlanId) {
        this.loadedPlanId = id;
        this.wins.set(refl?.wins ?? '');
        this.slipped.set(refl?.slipped ?? '');
        this.nextFocus.set(refl?.nextFocus ?? '');
        this.reflStatus.set('');
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.reflTimer) clearTimeout(this.reflTimer);
    });
  }

  formatDur(min: number): string {
    return formatDuration(min);
  }

  formatShort(iso: string): string {
    return shortDate(iso);
  }

  letterOf(iso: string): string {
    return dayLetter(iso);
  }

  catWidth(min: number): number {
    return Math.max(4, Math.round((min / this.maxCatMin()) * 100));
  }

  shiftWeek(deltaDays: number): void {
    this.flushRefl();
    this.state.weekMonday.set(addDays(this.state.weekMonday(), deltaDays));
  }

  moveUnfinishedNextMonday(): void {
    const ids = this.review().unfinished.map(t => t.id);
    const target = addDays(mondayOf(this.state.weekMonday()), 7);
    void this.state.rolloverTasks(ids, target);
  }

  onChartPointer(event: PointerEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const { x } = pointerIn(svg, event);
    const rect = svg.getBoundingClientRect();
    const ratio = rect.width > 0 ? this.chartW / rect.width : 1;
    const svgX = x * ratio;
    const plotW = this.chartW - this.padL - this.padR;
    const idx = Math.floor(((svgX - this.padL) / plotW) * this.series().length);
    const pt = this.series()[idx];
    if (!pt) {
      this.tip.set(null);
      return;
    }
    this.tip.set({
      x: Math.min(Math.max(8, x - 40), Math.max(8, rect.width - 170)),
      y: 8,
      label: shortDate(pt.date),
      focusedMin: pt.focusedMin,
      plannedMin: pt.plannedMin,
    });
  }

  onReflInput(field: 'wins' | 'slipped' | 'nextFocus', event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    if (field === 'wins') this.wins.set(val);
    else if (field === 'slipped') this.slipped.set(val);
    else this.nextFocus.set(val);
    this.reflStatus.set('Saving…');
    if (this.reflTimer) clearTimeout(this.reflTimer);
    const id = this.planId();
    this.reflTimer = setTimeout(() => {
      this.reflTimer = null;
      void this.state
        .saveReflection(id, {
          wins: this.wins(),
          slipped: this.slipped(),
          nextFocus: this.nextFocus(),
        })
        .then(() => this.reflStatus.set('Saved'));
    }, 400);
  }

  flushRefl(): void {
    if (!this.reflTimer) return;
    clearTimeout(this.reflTimer);
    this.reflTimer = null;
    const id = this.loadedPlanId || this.planId();
    void this.state
      .saveReflection(id, {
        wins: this.wins(),
        slipped: this.slipped(),
        nextFocus: this.nextFocus(),
      })
      .then(() => this.reflStatus.set('Saved'));
  }
}
