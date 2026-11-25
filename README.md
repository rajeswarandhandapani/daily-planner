# Daily Planner (Angular + Tailwind CSS + DaisyUI)

A private daily, weekly and monthly planner with Top 3 priorities, time blocks, a Pomodoro focus timer, daily habits, one-tap overdue rollover, a guided weekly review and SVG insights. It runs entirely in the browser with no server or account, works offline via `@angular/service-worker`, and keeps all plans locally on the device in IndexedDB.

## Live App & Deployment

- **URL:** `https://rajeswarandhandapani.com/daily-planner/`
- Every push to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which runs `npm ci`, runs `npm test`, builds with `--base-href /daily-planner/`, and deploys directly via `actions/deploy-pages` (GitHub Pages **Source: GitHub Actions**, custom domain blank so it inherits `rajeswarandhandapani.com`).

## Run locally

```powershell
npm.cmd install
npm.cmd start
```

Then open `http://localhost:4184`.

## Build & Test

```powershell
# Domain unit tests (calendar math, grouping, conflicts, rollover, streaks, review, .ics, backups)
npm.cmd test

# Production build (GitHub Pages subfolder base-href + service worker)
npm.cmd run build:pages

# Local production build (relative base-href) & full Playwright E2E + offline test
npm.cmd run build
npm.cmd run test:browser
```

## Architecture

Built with standalone, zoneless Angular (Signals, `@if`/`@for`, hash routing), **Tailwind CSS v4 + DaisyUI v5** (system-aware Nord light / Dim dark + user-selectable presets), and shared kit primitives synced from [`angular-pwa-kit`](../angular-pwa-kit) (`src/app/kit/`).

| Path | Purpose |
| --- | --- |
| `src/app/domain/` (`models.ts`, `logic.ts`, `calendar-ics.ts`) | Task sorting, time-block conflicts, rollover, streaks, weekly review, `.ics` export, backup validation |
| `src/app/services/` (`planner-store`, `planner-state`, `focus-timer`, `reminder`) | IndexedDB persistence, reactive signal state, Pomodoro focus timer with Wake Lock & breaks, daily reminders |
| `src/app/views/` (`today/`, `week/`, `month/`, `review/`, `data/`) | Daily planner, 7-day board, monthly calendar, weekly review & SVG charts, theme/settings/backups |
| `src/app/kit/` | Shared `angular-pwa-kit` theme, IndexedDB helper, shell, toast, confirm dialog, dates, `.ics`, and chart helpers |
| `ngsw-config.json` | Offline asset caching via `@angular/service-worker` |

- **Storage:** IndexedDB `'daily-planner'` (`v1`: `tasks`, `days`, `plans`, `kv`).
- **Security:** Strict Content Security Policy with zero external network requests.
