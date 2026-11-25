import { Injectable } from '@angular/core';
import { createDb, requestPersist } from '../kit/idb';
import type { DayRecord, PeriodPlan, TaskItem } from '../domain/models';

@Injectable({ providedIn: 'root' })
export class PlannerStoreService {
  private readonly db = createDb({
    name: 'daily-planner',
    version: 1,
    stores: [
      { name: 'tasks', keyPath: 'id' },
      { name: 'days', keyPath: 'date' },
      { name: 'plans', keyPath: 'id' },
      { name: 'kv' },
    ],
  });

  getAllTasks(): Promise<TaskItem[]> {
    return this.db.getAll<TaskItem>('tasks');
  }

  putTask(task: TaskItem): Promise<void> {
    requestPersist();
    return this.db.put('tasks', task);
  }

  putTasks(tasks: TaskItem[]): Promise<void> {
    requestPersist();
    return this.db.putMany('tasks', tasks);
  }

  deleteTask(id: string): Promise<void> {
    return this.db.del('tasks', id);
  }

  getAllDays(): Promise<DayRecord[]> {
    return this.db.getAll<DayRecord>('days');
  }

  putDay(day: DayRecord): Promise<void> {
    requestPersist();
    return this.db.put('days', day);
  }

  deleteDay(date: string): Promise<void> {
    return this.db.del('days', date);
  }

  getAllPlans(): Promise<PeriodPlan[]> {
    return this.db.getAll<PeriodPlan>('plans');
  }

  putPlan(plan: PeriodPlan): Promise<void> {
    requestPersist();
    return this.db.put('plans', plan);
  }

  deletePlan(id: string): Promise<void> {
    return this.db.del('plans', id);
  }

  getKv<T>(key: string): Promise<T | undefined> {
    return this.db.getKv<T>(key);
  }

  setKv<T>(key: string, value: T): Promise<void> {
    requestPersist();
    return this.db.setKv(key, value);
  }

  async replaceAll(
    tasks: TaskItem[],
    days: DayRecord[],
    plans: PeriodPlan[],
    settings: unknown,
  ): Promise<void> {
    requestPersist();
    await this.db.eraseAll();
    if (tasks.length) await this.db.putMany('tasks', tasks);
    if (days.length) await this.db.putMany('days', days);
    if (plans.length) await this.db.putMany('plans', plans);
    await this.db.setKv('settings', settings);
  }

  eraseAll(): Promise<void> {
    return this.db.eraseAll();
  }
}
