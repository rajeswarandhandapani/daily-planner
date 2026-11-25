import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FocusTimerService } from '../services/focus-timer.service';

@Component({
  selector: 'dp-focus-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      id="focus"
      class="focus-bar"
      role="timer"
      aria-label="Focus timer"
      [hidden]="!timer.running()"
    >
      <span id="focus-label">
        {{ timer.kind() === 'break' ? 'Break · ' : 'Focus · ' }}{{ timer.label() }}
      </span>
      <b id="focus-time">{{ timer.formattedTime() }}</b>
      <button
        type="button"
        class="btn btn-xs btn-outline"
        aria-label="5 minutes less"
        (click)="timer.adjust(-5)"
      >
        −5
      </button>
      <button
        type="button"
        class="btn btn-xs btn-outline"
        aria-label="5 minutes more"
        (click)="timer.adjust(5)"
      >
        +5
      </button>
      <button
        type="button"
        class="btn btn-xs btn-outline"
        (click)="timer.stop()"
      >
        Stop
      </button>
      <div class="focus-track" aria-hidden="true">
        <i id="focus-fill" [style.width.%]="timer.progressPct()"></i>
      </div>
    </div>
  `,
})
export class FocusBarComponent {
  readonly timer = inject(FocusTimerService);
}
