import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { habitStreak } from '../../domain/logic';
import { PlannerStateService } from '../../services/planner-state.service';

@Component({
  selector: 'dp-habit-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card bg-base-100 border border-base-300 shadow-xs" data-testid="habits-card">
      <div class="card-body p-4 gap-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-base font-bold m-0">Daily habits</h2>
          @if (state.activeHabits().length > 0 || adding()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs min-h-8"
              (click)="adding.set(!adding())"
            >
              {{ adding() ? 'Done' : '+ Habit' }}
            </button>
          }
        </div>

        @if (state.activeHabits().length === 0 && !adding()) {
          <div class="flex items-center justify-between gap-2 text-sm opacity-75">
            <span>Track daily routines alongside your tasks.</span>
            <button type="button" class="btn btn-outline btn-xs min-h-8" (click)="adding.set(true)">
              Add a habit
            </button>
          </div>
        } @else if (state.activeHabits().length > 0) {
          <div class="flex flex-wrap gap-2">
            @for (h of state.activeHabits(); track h.id) {
              <button
                type="button"
                class="btn btn-sm btn-outline rounded-full chip-btn gap-1.5"
                [attr.aria-pressed]="'' + isChecked(h.id)"
                [attr.aria-label]="'Habit ' + h.name"
                (click)="state.toggleHabit(date(), h.id)"
              >
                <span>{{ isChecked(h.id) ? '✓' : '○' }}</span>
                <span>{{ h.name }}</span>
                @if (streakOf(h.id) > 0) {
                  <span class="text-xs opacity-80" [attr.data-streak]="h.id">
                    🔥 {{ streakOf(h.id) }}
                  </span>
                }
              </button>
            }
          </div>
        }

        @if (adding()) {
          <form class="flex gap-2" (submit)="createHabit($event)">
            <input
              type="text"
              class="input input-bordered input-sm flex-1 min-h-10"
              placeholder="e.g. Morning review, Walk 20m"
              aria-label="New habit name"
              [value]="newName()"
              (input)="newName.set(asValue($event))"
            />
            <button type="submit" class="btn btn-primary btn-sm min-h-10">Add</button>
          </form>
        }
      </div>
    </section>
  `,
})
export class HabitStripComponent {
  readonly date = input.required<string>();
  readonly state = inject(PlannerStateService);

  readonly adding = signal(false);
  readonly newName = signal('');

  isChecked(habitId: string): boolean {
    return Boolean(this.state.days()[this.date()]?.habits?.[habitId]);
  }

  streakOf(habitId: string): number {
    return habitStreak(this.state.days(), habitId, this.state.today());
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  async createHabit(event: Event): Promise<void> {
    event.preventDefault();
    const ok = await this.state.addHabit(this.newName());
    if (ok) {
      this.newName.set('');
      this.adding.set(false);
    }
  }
}
