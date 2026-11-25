import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { addDays, formatDuration, nextMonday } from '../../domain/logic';
import {
  CATEGORIES,
  type CategoryId,
  DURATION_PRESETS,
  type Priority,
  type TaskItem,
} from '../../domain/models';
import { FocusTimerService } from '../../services/focus-timer.service';
import { PlannerStateService } from '../../services/planner-state.service';

@Component({
  selector: 'dp-task-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="task-card"
      [class.is-done]="task().done"
      [class.is-top3]="task().top3"
      [class.is-conflict]="conflict()"
      [attr.data-task]="task().id"
    >
      <div class="flex items-start gap-2.5">
        <button
          type="button"
          class="tick"
          [attr.aria-pressed]="'' + task().done"
          [attr.aria-label]="(task().done ? 'Mark incomplete: ' : 'Complete ') + task().title"
          (click)="state.toggleDone(task().id)"
        >
          {{ task().done ? '✓' : '' }}
        </button>

        <div class="flex-1 min-w-0">
          <div class="flex items-start justify-between gap-2">
            <button
              type="button"
              class="text-left font-semibold text-sm leading-snug bg-transparent border-0 p-0 cursor-pointer hover:underline break-words"
              [class.line-through]="task().done"
              [attr.aria-expanded]="'' + editing()"
              [attr.aria-label]="'Edit ' + task().title"
              (click)="toggleEdit()"
            >
              {{ task().title }}
            </button>

            <div class="flex items-center gap-1 flex-none">
              <button
                type="button"
                class="btn btn-ghost btn-xs px-1.5"
                [class.text-warning]="task().top3"
                [attr.aria-pressed]="'' + task().top3"
                [attr.aria-label]="(task().top3 ? 'Unpin Top 3: ' : 'Pin Top 3: ') + task().title"
                (click)="state.toggleTop3(task().id)"
              >
                {{ task().top3 ? '★' : '☆' }}
              </button>
              @if (!task().done) {
                <button
                  type="button"
                  class="btn btn-outline btn-xs"
                  [class.btn-primary]="isFocusing()"
                  [attr.aria-label]="'Focus on ' + task().title"
                  (click)="focusTimer.startFocus(task())"
                >
                  ▶ Focus
                </button>
              }
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 mt-1 text-xs opacity-80">
            <span class="inline-flex items-center gap-1">
              <i class="cat-dot" [style.background]="'var(' + catMeta().colorVar + ')'"></i>
              {{ catMeta().label }}
            </span>

            @if (task().startTime; as st) {
              <span class="badge badge-ghost badge-xs font-mono">{{ st }}</span>
            }

            <span class="badge badge-ghost badge-xs">{{ formatDur(task().durationMin) }}</span>

            @if (task().priority === 'high') {
              <span class="badge badge-warning badge-xs">High</span>
            }

            @if (conflict()) {
              <span class="badge badge-error badge-xs" data-testid="conflict-badge">Overlap</span>
            }

            @if (task().rolloverCount > 0) {
              <span class="badge badge-outline badge-xs" data-testid="rollover-badge">
                ↻ {{ task().rolloverCount }}
              </span>
            }

            @if (focusedMin() > 0) {
              <span class="badge badge-primary badge-outline badge-xs" data-testid="focused-badge">
                {{ focusedMin() }}m focused
              </span>
            }

            @if (task().subtasks.length > 0) {
              <span class="opacity-75">
                {{ doneSubtasks() }}/{{ task().subtasks.length }} steps
              </span>
            }
          </div>
        </div>
      </div>

      @if (editing()) {
        <div class="border-t border-base-300 pt-2.5 flex flex-col gap-2.5" data-testid="task-editor">
          <div class="flex flex-col gap-2">
            <label class="flex flex-col gap-1">
              <span class="text-xs opacity-70">Title</span>
              <input
                type="text"
                class="input input-bordered input-sm w-full"
                aria-label="Edit task title"
                [value]="editTitle()"
                (input)="editTitle.set(asValue($event))"
              />
            </label>

            <div class="flex flex-wrap gap-2">
              <label class="flex flex-col gap-1">
                <span class="text-xs opacity-70">Start time</span>
                <input
                  type="time"
                  class="input input-bordered input-sm"
                  aria-label="Edit start time"
                  [value]="editTime()"
                  (input)="editTime.set(asValue($event))"
                />
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs opacity-70">Duration</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Edit duration"
                  [value]="'' + editDuration()"
                  (change)="editDuration.set(+asValue($event))"
                >
                  @for (m of durations; track m) {
                    <option [value]="m" [selected]="m === editDuration()">{{ m }} min</option>
                  }
                </select>
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs opacity-70">Category</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Edit category"
                  [value]="editCategory()"
                  (change)="editCategory.set(asCategory($event))"
                >
                  @for (c of categories; track c.id) {
                    <option [value]="c.id" [selected]="c.id === editCategory()">{{ c.label }}</option>
                  }
                </select>
              </label>

              <label class="flex flex-col gap-1">
                <span class="text-xs opacity-70">Priority</span>
                <select
                  class="select select-bordered select-sm"
                  aria-label="Edit priority"
                  [value]="editPriority()"
                  (change)="editPriority.set(asPriority($event))"
                >
                  <option value="normal" [selected]="editPriority() === 'normal'">Normal</option>
                  <option value="high" [selected]="editPriority() === 'high'">High</option>
                </select>
              </label>
            </div>

            <label class="flex flex-col gap-1">
              <span class="text-xs opacity-70">Notes</span>
              <textarea
                rows="2"
                class="textarea textarea-bordered textarea-sm w-full"
                aria-label="Edit task notes"
                [value]="editNotes()"
                (input)="editNotes.set(asValue($event))"
              ></textarea>
            </label>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-primary btn-xs min-h-8" (click)="saveEdits()">
                Save changes
              </button>
              <button type="button" class="btn btn-ghost btn-xs min-h-8" (click)="editing.set(false)">
                Cancel
              </button>
            </div>
          </div>

          <div class="border-t border-base-300 pt-2 flex flex-col gap-1.5">
            <span class="text-xs font-semibold opacity-75">Subtasks</span>
            @for (sub of task().subtasks; track sub.id) {
              <div class="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  class="checkbox checkbox-xs checkbox-primary"
                  [checked]="sub.done"
                  [attr.aria-label]="'Toggle subtask ' + sub.title"
                  (change)="state.toggleSubtask(task().id, sub.id)"
                />
                <span class="flex-1 break-words" [class.line-through]="sub.done" [class.opacity-60]="sub.done">
                  {{ sub.title }}
                </span>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs opacity-65"
                  [attr.aria-label]="'Remove subtask ' + sub.title"
                  (click)="state.deleteSubtask(task().id, sub.id)"
                >
                  ×
                </button>
              </div>
            }
            <div class="flex gap-1.5">
              <input
                type="text"
                class="input input-bordered input-xs flex-1 min-h-8"
                placeholder="Add a step…"
                aria-label="New subtask"
                [value]="newSubtask()"
                (input)="newSubtask.set(asValue($event))"
                (keydown.enter)="addSubtask($event)"
              />
              <button type="button" class="btn btn-outline btn-xs min-h-8" (click)="addSubtask()">
                + Step
              </button>
            </div>
          </div>

          <div class="border-t border-base-300 pt-2 flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-xs opacity-70">Move:</span>
              <button
                type="button"
                class="btn btn-outline btn-xs"
                (click)="moveTo(tomorrowIso())"
              >
                Tomorrow
              </button>
              <button
                type="button"
                class="btn btn-outline btn-xs"
                (click)="moveTo(nextMonIso())"
              >
                Next Mon
              </button>
              <input
                type="date"
                class="input input-bordered input-xs"
                aria-label="Move task to date"
                [value]="task().date"
                (change)="onMoveDate($event)"
              />
            </div>

            <button
              type="button"
              class="btn btn-ghost btn-xs text-error"
              [attr.aria-label]="'Delete ' + task().title"
              (click)="state.deleteTask(task().id)"
            >
              Delete
            </button>
          </div>
        </div>
      }
    </article>
  `,
})
export class TaskCardComponent {
  readonly task = input.required<TaskItem>();
  readonly conflict = input(false);

  readonly state = inject(PlannerStateService);
  readonly focusTimer = inject(FocusTimerService);

  readonly categories = CATEGORIES;
  readonly durations = DURATION_PRESETS;

  readonly editing = signal(false);
  readonly editTitle = signal('');
  readonly editTime = signal('');
  readonly editDuration = signal(30);
  readonly editCategory = signal<CategoryId>('work');
  readonly editPriority = signal<Priority>('normal');
  readonly editNotes = signal('');
  readonly newSubtask = signal('');

  readonly catMeta = computed(
    () => CATEGORIES.find(c => c.id === this.task().category) ?? CATEGORIES[0],
  );
  readonly focusedMin = computed(() => this.state.focusMinutesByTask()[this.task().id] ?? 0);
  readonly doneSubtasks = computed(() => this.task().subtasks.filter(s => s.done).length);
  readonly isFocusing = computed(
    () => this.focusTimer.running() && this.focusTimer.activeTaskId() === this.task().id,
  );
  readonly tomorrowIso = computed(() => addDays(this.state.today(), 1));
  readonly nextMonIso = computed(() => nextMonday(addDays(this.state.today(), 1)));

  formatDur(min: number): string {
    return formatDuration(min);
  }

  toggleEdit(): void {
    const next = !this.editing();
    if (next) {
      const t = this.task();
      this.editTitle.set(t.title);
      this.editTime.set(t.startTime ?? '');
      this.editDuration.set(t.durationMin);
      this.editCategory.set(t.category);
      this.editPriority.set(t.priority);
      this.editNotes.set(t.notes);
    }
    this.editing.set(next);
  }

  asValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value;
  }

  asCategory(event: Event): CategoryId {
    return (event.target as HTMLSelectElement).value as CategoryId;
  }

  asPriority(event: Event): Priority {
    return (event.target as HTMLSelectElement).value as Priority;
  }

  async saveEdits(): Promise<void> {
    const ok = await this.state.updateTask(this.task().id, {
      title: this.editTitle(),
      startTime: this.editTime() || null,
      durationMin: this.editDuration(),
      category: this.editCategory(),
      priority: this.editPriority(),
      notes: this.editNotes(),
    });
    if (ok) this.editing.set(false);
  }

  async addSubtask(event?: Event): Promise<void> {
    event?.preventDefault();
    const val = this.newSubtask().trim();
    if (!val) return;
    await this.state.addSubtask(this.task().id, val);
    this.newSubtask.set('');
  }

  moveTo(targetIso: string): void {
    void this.state.moveTask(this.task().id, targetIso);
    this.editing.set(false);
  }

  onMoveDate(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    if (val) this.moveTo(val);
  }
}
