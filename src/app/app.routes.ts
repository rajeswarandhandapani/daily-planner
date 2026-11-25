import type { Routes } from '@angular/router';
import { TodayPageComponent } from './views/today/today-page.component';

export const routes: Routes = [
  { path: '', component: TodayPageComponent, pathMatch: 'full' },
  {
    path: 'week',
    loadComponent: () => import('./views/week/week-page.component').then(m => m.WeekPageComponent),
  },
  {
    path: 'month',
    loadComponent: () => import('./views/month/month-page.component').then(m => m.MonthPageComponent),
  },
  {
    path: 'review',
    loadComponent: () => import('./views/review/review-page.component').then(m => m.ReviewPageComponent),
  },
  {
    path: 'data',
    loadComponent: () => import('./views/data/data-page.component').then(m => m.DataPageComponent),
  },
  { path: '**', redirectTo: '' },
];
