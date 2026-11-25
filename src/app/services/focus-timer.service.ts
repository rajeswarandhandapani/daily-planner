// App-specific Pomodoro focus timer service with Wake Lock, WebAudio chime,
// single-path session logging (both completion and partial stop), and break offers.

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { ToastService } from '../kit/toast.service';
import type { TaskItem } from '../domain/models';
import { PlannerStateService } from './planner-state.service';

const formatStamp = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

@Injectable({ providedIn: 'root' })
export class FocusTimerService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly state = inject(PlannerStateService);
  private readonly toast = inject(ToastService);

  readonly running = signal(false);
  readonly kind = signal<'focus' | 'break'>('focus');
  readonly activeTaskId = signal<string | null>(null);
  readonly label = signal('Focus');
  readonly remainingSec = signal(0);
  readonly progressPct = signal(100);
  readonly formattedTime = computed(() => formatStamp(this.remainingSec()));

  private sessionDate = '';
  private startedAt = 0;
  private end = 0;
  private plannedMs = 0;
  private completedFocusCount = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private audio: AudioContext | null = null;
  private wake: WakeLockSentinel | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      const onVis = () => {
        if (!document.hidden && this.running()) {
          this.tick();
          void this.keepAwake(true);
        }
      };
      document.addEventListener('visibilitychange', onVis);
      this.destroyRef.onDestroy(() => {
        document.removeEventListener('visibilitychange', onVis);
        this.clearTicker();
        void this.keepAwake(false);
      });
    }
  }

  startFocus(task: TaskItem): void {
    if (this.running()) this.finish('stopped');
    const minutes = this.state.settings().focusMinutes;
    this.startCountdown({
      kind: 'focus',
      minutes,
      taskId: task.id,
      date: task.date ?? this.state.today(),
      label: task.title,
    });
  }

  startBreak(minutes: number): void {
    if (this.running()) this.finish('stopped');
    this.startCountdown({
      kind: 'break',
      minutes,
      taskId: null,
      date: this.state.today(),
      label: `${minutes}-min break`,
    });
  }

  adjust(deltaMin: number): void {
    if (!this.running()) return;
    const deltaMs = deltaMin * 60_000;
    const now = Date.now();
    this.end = Math.max(now + 1000, this.end + deltaMs);
    this.plannedMs = Math.max(60_000, this.plannedMs + deltaMs);
    this.tick();
  }

  stop(): void {
    if (!this.running()) return;
    this.finish('stopped');
  }

  private startCountdown(opts: {
    kind: 'focus' | 'break';
    minutes: number;
    taskId: string | null;
    date: string;
    label: string;
  }): void {
    if (this.state.settings().beep && typeof AudioContext !== 'undefined') {
      try {
        this.audio ??= new AudioContext();
        void this.audio.resume();
      } catch {
        this.audio = null;
      }
    }

    this.kind.set(opts.kind);
    this.activeTaskId.set(opts.taskId);
    this.label.set(opts.label);
    this.sessionDate = opts.date;
    this.plannedMs = opts.minutes * 60_000;
    this.startedAt = Date.now();
    this.end = this.startedAt + this.plannedMs;
    this.running.set(true);
    this.tick();

    this.clearTicker();
    this.ticker = setInterval(() => this.tick(), 250);
    void this.keepAwake(true);
  }

  private tick(): void {
    const rem = this.end - Date.now();
    const left = Math.ceil(rem / 1000);
    if (left <= 0) {
      this.finish('completed', rem);
      return;
    }
    this.remainingSec.set(left);
    this.progressPct.set(this.plannedMs > 0 ? Math.max(0, Math.min(100, (rem / this.plannedMs) * 100)) : 0);
  }

  /** Single logging path for both natural completion and manual Stop. */
  private finish(reason: 'completed' | 'stopped', overshootMs = 0): void {
    const currentKind = this.kind();
    const taskId = this.activeTaskId();
    const currentLabel = this.label();
    const date = this.sessionDate || this.state.today();
    const elapsedMs = this.startedAt ? Math.max(0, Date.now() - this.startedAt) : 0;
    const plannedMinutes = Math.max(1, Math.round(this.plannedMs / 60_000));

    this.clearTicker();
    this.startedAt = 0;
    this.running.set(false);
    this.activeTaskId.set(null);
    void this.keepAwake(false);

    if (reason === 'completed') {
      if (overshootMs > -3000) {
        this.playChime();
        try {
          navigator?.vibrate?.([180, 90, 180]);
        } catch {}
      }
      void this.state.logSession(date, taskId, currentKind, plannedMinutes);
      if (currentKind === 'focus') {
        this.completedFocusCount += 1;
        const breakMin =
          this.completedFocusCount % 4 === 0 ? 15 : this.state.settings().breakMinutes;
        this.toast.show(`${plannedMinutes}m focused on “${currentLabel}”.`, {
          label: `Start ${breakMin}m break`,
          run: () => this.startBreak(breakMin),
        });
      } else {
        this.toast.show('Break finished. Ready for your next focus block.');
      }
      return;
    }

    // Manual Stop: log whole elapsed minutes if >= 1 minute has passed.
    const elapsedMin = Math.floor(elapsedMs / 60_000);
    if (currentKind === 'focus' && elapsedMin >= 1) {
      void this.state.logSession(date, taskId, 'focus', elapsedMin);
      this.toast.show(`Logged ${elapsedMin}m on “${currentLabel}”.`);
    } else if (currentKind === 'break' && elapsedMin >= 1) {
      void this.state.logSession(date, null, 'break', elapsedMin);
      this.toast.show('Break ended.');
    } else {
      this.toast.show(currentKind === 'focus' ? 'Focus timer stopped.' : 'Break stopped.');
    }
  }

  private clearTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  private playChime(): void {
    if (!this.state.settings().beep || !this.audio) return;
    for (const at of [0, 0.25]) {
      const osc = this.audio.createOscillator();
      const gain = this.audio.createGain();
      osc.frequency.value = this.kind() === 'focus' ? 784 : 659;
      gain.gain.value = 0.14;
      osc.connect(gain).connect(this.audio.destination);
      osc.start(this.audio.currentTime + at);
      osc.stop(this.audio.currentTime + at + 0.16);
    }
  }

  private async keepAwake(on: boolean): Promise<void> {
    try {
      if (on && !this.wake && navigator?.wakeLock) {
        this.wake = await navigator.wakeLock.request('screen');
        this.wake.addEventListener?.('release', () => {
          this.wake = null;
        });
      }
      if (!on && this.wake) {
        await this.wake.release();
        this.wake = null;
      }
    } catch {
      this.wake = null;
    }
  }
}
