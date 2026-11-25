import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { FocusBarComponent } from './components/focus-bar.component';
import { AppShellComponent, type KitNavItem } from './kit/app-shell.component';
import { PlannerStateService } from './services/planner-state.service';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AppShellComponent, RouterOutlet, FocusBarComponent],
  template: `
    <kit-app-shell brand="Daily Planner" [navItems]="navItems" (click)="onShellClick($event)">
      <router-outlet />
    </kit-app-shell>
    <dp-focus-bar />
  `,
})
export class App {
  private readonly state = inject(PlannerStateService);

  readonly navItems: KitNavItem[] = [
    { label: 'Today', path: '/', exact: true },
    { label: 'Week', path: '/week' },
    { label: 'Month', path: '/month' },
    { label: 'Review', path: '/review' },
    { label: 'Data', path: '/data' },
  ];

  onShellClick(event: Event): void {
    const btn = (event.target as HTMLElement | null)?.closest('header nav button');
    if (btn?.textContent?.trim() === 'Today') {
      this.state.openDate(this.state.today());
    }
  }
}
