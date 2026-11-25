import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  CATEGORIES,
  type CategoryId,
  DURATION_PRESETS,
  type Priority,
} from '../../domain/models';
import { PlannerStateService } from '../../services/planner-state.service';

@Component({
  selector: 'dp-quick-add',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card bg-base-100 border border-base-300 shadow-xs" (submit)="submit($event)">
      <div class="card-body p-3 gap-2.5">
        <div class="flex gap-2">
          <input
            #titleInput
            type="text"
            class="input input-bordered flex-1 min-h-11"
            placeholder="Add a task… (press n)"
            aria-label="New task title"
            [value]="title()"
            (input)="title.set(asValue($event))"
          />
          <button type="submit" class="btn btn-primary min-h-11 px-4">Add</button>
        </div>

        <div class="flex flex-wrap items-center gap-2 text-xs">
          <label class="flex items-center gap-1.5">
            <span class="opacity-70">Time</span>
            <input
              type="time"
              class="input input-bordered input-xs min-h-8 w-auto"
              aria-label="Task start time"
              [value]="startTime()"
              (input)="startTime.set(asValue($event))"
            />
          </label>

          <select
            class="select select-bordered select-xs min-h-8 w-auto"
            aria-label="Task duration"
            [value]="'' + durationMin()"
            (change)="durationMin.set(+asValue($event))"
          >
            @for (m of durations; track m) {
              <option [value]="m" [selected]="m === durationMin()">{{ m }}m</option>
            }
          </select>

          <select
            class="select select-bordered select-xs min-h-8 w-auto"
            aria-label="Task category"
            [value]="category()"
            (change)="setCategory(asValue($event))"
          >
            @for (c of categories; track c.id) {
              <option [value]="c.id" [selected]="c.id === category()">{{ c.label }}</option>
            }
          </select>

          <button
            type="button"
            class="btn btn-xs btn-outline chip-btn min-h-8"
            aria-label="Mark as High priority"
            [attr.aria-pressed]="'' + (priority() === 'high')"
            (click)="toggleHigh()"
          >
            ! High
          </button>

          <button
            type="button"
            class="btn btn-xs btn-outline chip-btn min-h-8"
            aria-label="Pin as Top 3"
            [attr.aria-pressed]="'' + top3()"
            (click)="top3.set(!top3())"
          >
            ★ Top 3
          </button>
        </div>
      </div>
    </form>
  `,
})
export class QuickAddComponent {
  readonly date = input.required<string>();
  private readonly state = inject(PlannerStateService);
  private readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('titleInput');

  readonly categories = CATEGORIES;
  readonly durations = DURATION_PRESETS;

  readonly title = signal('');
  readonly startTime = signal('');
  readonly durationMin = signal(30);
  readonly category = signal<CategoryId>('work');
  readonly priority = signal<Priority>('normal');
  readonly top3 = signal(false);

  focusInput(): void {
    this.inputRef()?.nativeElement.focus();
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  setCategory(val: string): void {
    this.category.set(val as CategoryId);
  }

  toggleHigh(): void {
    this.priority.update(p => (p === 'high' ? 'normal' : 'high'));
  }

  async submit(event: Event): Promise<void> {
    event.preventDefault();
    const created = await this.state.addTask({
      title: this.title(),
      date: this.date(),
      startTime: this.startTime() || null,
      durationMin: this.durationMin(),
      priority: this.priority(),
      top3: this.top3(),
      category: this.category(),
    });
    if (!created) return;
    this.title.set('');
    this.startTime.set('');
    this.priority.set('normal');
    this.top3.set(false);
    this.focusInput();
  }
}
