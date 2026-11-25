import { DestroyRef, Injectable, inject } from '@angular/core';
import { ToastService } from '../kit/toast.service';
import { localToday, reminderDue, reminderSummary } from '../domain/logic';
import { PlannerStateService } from './planner-state.service';
import { PlannerStoreService } from './planner-store.service';

const localTime = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

@Injectable({ providedIn: 'root' })
export class ReminderService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(PlannerStoreService);
  private readonly state = inject(PlannerStateService);
  private readonly toast = inject(ToastService);

  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start(): void {
    if (this.started || typeof document === 'undefined') return;
    this.started = true;
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      this.state.refreshTodayIfChanged();
      void this.check();
    };
    document.addEventListener('visibilitychange', onVis);
    this.timer = setInterval(() => void this.check(), 30_000);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVis);
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    });
    void this.check();
  }

  async check(): Promise<void> {
    const date = localToday();
    const summary = reminderSummary(this.state.tasks(), date);
    if (
      !reminderDue({
        reminder: this.state.settings().reminder,
        date,
        nowTime: localTime(),
        isDone: summary.allTop3Done,
        lastSent: this.state.lastReminder(),
      })
    ) {
      return;
    }
    this.state.lastReminder.set(date);
    await this.store.setKv('lastReminder', date);
    await this.show(date);
  }

  async show(date: string, { test = false }: { test?: boolean } = {}): Promise<void> {
    const info = reminderSummary(this.state.tasks(), date);
    let shown = false;
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        if (reg?.showNotification) {
          await reg.showNotification(info.title, {
            body: info.body,
            tag: 'daily-planner-reminder',
            icon: 'icons/icon-192.png',
          });
          shown = true;
        } else {
          new Notification(info.title, {
            body: info.body,
            tag: 'daily-planner-reminder',
            icon: 'icons/icon-192.png',
          });
          shown = true;
        }
      } catch {}
    }
    this.toast.show(test && shown ? `Reminder sent: ${info.title}` : `${info.title} — ${info.body}`);
  }
}
