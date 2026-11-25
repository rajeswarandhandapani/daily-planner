// End-to-end Playwright browser test against production Angular dist/ output. Usage: npm run test:browser
const { chromium } = require('playwright');
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { DIST_ROOT, start } = require('../scripts/serve-dist.cjs');

const PORT = Number(process.env.PORT) || 4184;
const URL = `http://127.0.0.1:${PORT}/`;
const OUT = path.join(__dirname, '..', 'test-output');
const WEDNESDAY = new Date('2026-11-25T09:00:00');

const nav = (page, name) => page.locator('header nav button', { hasText: name }).click();

async function noOverflow(page, label) {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(wide <= 0, `${label} overflows sideways by ${wide}px`);
}

(async () => {
  assert.ok(fs.existsSync(path.join(DIST_ROOT, 'index.html')), 'dist index.html missing — run npm run build first');
  assert.ok(fs.existsSync(path.join(DIST_ROOT, 'ngsw-worker.js')), 'ngsw-worker.js missing from dist');
  assert.ok(fs.existsSync(path.join(DIST_ROOT, 'ngsw.json')), 'ngsw.json missing from dist');

  fs.mkdirSync(OUT, { recursive: true });
  const server = await start(PORT);
  const browser = await chromium.launch()
    .catch(() => chromium.launch({ channel: 'chrome' }))
    .catch(() => chromium.launch({ channel: 'msedge' }));
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();

  const errors = [];
  const external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) {
      errors.push(m.text());
    }
  });
  context.on('request', r => {
    if (!r.url().startsWith(URL) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) {
      external.push(r.url());
    }
  });
  await page.clock.install({ time: WEDNESDAY });

  // 1. Load Today
  await page.goto(URL);
  await page.getByRole('heading', { name: 'Today, Nov 25' }).waitFor();
  await noOverflow(page, 'Today empty (390px)');

  // 2. Quick-add Top 3 timed, High, and untimed tasks; enforce Top 3 cap.
  const titleInput = page.getByRole('textbox', { name: 'New task title' });
  const timeInput = page.getByLabel('Task start time');
  const durSelect = page.getByRole('combobox', { name: 'Task duration' });
  const highBtn = page.getByRole('button', { name: 'Mark as High priority' });
  const top3Btn = page.getByRole('button', { name: 'Pin as Top 3' });
  const addBtn = page.locator('dp-quick-add button[type="submit"]');

  // Task 1: Top 3 + High + 09:00 60m
  await titleInput.fill('Ship Q4; budget, plan');
  await timeInput.fill('09:00');
  await durSelect.selectOption('60');
  await highBtn.click();
  await top3Btn.click();
  await addBtn.click();
  await page.locator('[data-testid="top3-section"]').getByText('Ship Q4; budget, plan').waitFor();

  // Task 2: Top 3 + 09:30 30m (overlaps Task 1!)
  await titleInput.fill('Design sync');
  await timeInput.fill('09:30');
  await durSelect.selectOption('30');
  await top3Btn.click();
  await addBtn.click();
  await page.locator('[data-testid="conflict-badge"]').first().waitFor();

  // Task 3: Top 3 untimed
  await titleInput.fill('Write architecture doc');
  await top3Btn.click();
  await addBtn.click();
  await page.getByText('Write architecture doc').waitFor();

  // Task 4: 4th Top 3 should be refused with toast
  await titleInput.fill('Fourth priority');
  await top3Btn.click();
  await addBtn.click();
  await page.locator('#toast', { hasText: 'already have 3 Top 3' }).waitFor();
  // Unpin Top 3 and add normally
  await top3Btn.click();
  await addBtn.click();
  await page.getByText('Fourth priority').waitFor();

  // 3. Inline edit + subtasks
  await page.getByRole('button', { name: 'Edit Write architecture doc' }).click();
  await page.locator('[data-testid="task-editor"]').waitFor();
  await page.getByRole('textbox', { name: 'Edit task title' }).fill('Write architecture spec');
  await page.getByRole('textbox', { name: 'New subtask' }).fill('Draft diagram');
  await page.getByRole('button', { name: '+ Step' }).click();
  await page.getByRole('checkbox', { name: 'Toggle subtask Draft diagram' }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.getByText('Write architecture spec').waitFor();
  await page.getByText('1/1 steps').waitFor();

  // 4. Toggle Timeline view and back to Grouped
  await page.getByRole('button', { name: 'Timeline' }).click();
  await page.locator('[data-testid="timeline-view"]').waitFor();
  await noOverflow(page, 'Today Timeline (390px)');
  await page.getByRole('button', { name: 'Grouped' }).click();
  await page.locator('[data-testid="timeline-view"]').waitFor({ state: 'hidden' });

  // 5. Focus timer: #focus visible, kit #timer-bar stays hidden, logs completion + break offer, and logs partial stop.
  await page.getByRole('button', { name: 'Focus on Design sync' }).click();
  await page.locator('#focus').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#timer-bar').isVisible(), false, 'kit timer bar must stay hidden');
  await page.clock.fastForward(25 * 60 * 1000 + 1000);
  await page.locator('#focus').waitFor({ state: 'hidden' });
  await page.locator('#toast', { hasText: '25m focused' }).waitFor();
  assert.ok(await page.locator('#toast button', { hasText: 'Start 5m break' }).isVisible());
  await page.locator('[data-testid="focused-badge"]', { hasText: '25m focused' }).waitFor();

  // Manual stop after 7 minutes logs 7m
  await page.getByRole('button', { name: 'Focus on Fourth priority' }).click();
  await page.locator('#focus').waitFor({ state: 'visible' });
  await page.clock.fastForward(7 * 60 * 1000 + 5000);
  await page.locator('#focus button', { hasText: 'Stop' }).click();
  await page.locator('#focus').waitFor({ state: 'hidden' });
  await page.locator('[data-testid="focused-badge"]', { hasText: '7m focused' }).waitFor();

  // 6. Seed an overdue task on Yesterday (Nov 24), return to Today, roll over + Undo + roll over
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('heading', { name: 'Tuesday, November 24' }).waitFor();
  await titleInput.fill('Pay electric bill');
  await addBtn.click();
  await page.getByText('Pay electric bill').waitFor();
  await page.getByRole('button', { name: 'Back to today →' }).click();
  await page.getByRole('heading', { name: 'Today, Nov 25' }).waitFor();
  await page.locator('[data-testid="rollover-banner"]').waitFor();
  await page.getByRole('button', { name: 'Move all to today' }).click();
  await page.locator('[data-testid="rollover-badge"]', { hasText: '↻ 1' }).waitFor();
  await page.locator('#toast button', { hasText: 'Undo' }).click();
  await page.locator('[data-testid="rollover-banner"]').waitFor();
  await page.getByRole('button', { name: 'Move all to today' }).click();
  await page.locator('[data-testid="rollover-badge"]', { hasText: '↻ 1' }).waitFor();

  // 7. Habits from Today + Daily Note with XSS payload + reload persistence
  await page.getByRole('button', { name: 'Add a habit' }).click();
  await page.getByRole('textbox', { name: 'New habit name' }).fill('Morning walk');
  await page.locator('[data-testid="habits-card"] button[type="submit"]').click();
  await page.getByRole('button', { name: 'Habit Morning walk' }).click();
  await page.locator('[data-testid="habits-card"]', { hasText: '🔥 1' }).waitFor();

  const note = page.getByRole('textbox', { name: 'Note for this day' });
  await note.fill('<img src=x onerror="window.__xss=1">');
  await page.clock.runFor(500);
  await page.locator('[data-testid="note-status"]', { hasText: 'Saved' }).waitFor();

  await page.screenshot({ path: path.join(OUT, 'today.png'), fullPage: true });
  await page.reload();
  await page.getByRole('heading', { name: 'Today, Nov 25' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Note for this day' }).inputValue(), '<img src=x onerror="window.__xss=1">');
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  await page.locator('[data-testid="focused-badge"]', { hasText: '25m focused' }).waitFor();

  // 8. Week view: add goal, move task with arrow button, check overflow
  await nav(page, 'Week');
  await page.locator('[data-testid="week-goals"]').waitFor();
  await page.getByRole('textbox', { name: 'New weekly goal' }).fill('Finish Q4 launch');
  await page.locator('[data-testid="week-goals"] button[type="submit"]').click();
  await page.getByText('Finish Q4 launch').waitFor();
  await page.getByRole('button', { name: 'Move Fourth priority later' }).click();
  await page.locator('[data-week-day="2026-11-26"]').getByText('Fourth priority').waitFor();
  await noOverflow(page, 'Week (390px)');
  await page.screenshot({ path: path.join(OUT, 'week.png'), fullPage: true });

  // 9. Month view: add goal, select date, move task via date picker, Open day
  await nav(page, 'Month');
  await page.locator('[data-testid="month-goals"]').waitFor();
  await page.getByRole('textbox', { name: 'New monthly goal' }).fill('Close November sprint');
  await page.locator('[data-testid="month-goals"] button[type="submit"]').click();
  await page.getByText('Close November sprint').waitFor();
  await page.locator('[data-month-day="2026-11-26"]').click();
  await page.locator('[data-testid="month-inspector"]').getByText('Fourth priority').waitFor();
  await page.getByLabel('Move Fourth priority to date').fill('2026-11-27');
  await page.locator('[data-month-day="2026-11-27"]').click();
  await page.locator('[data-testid="month-inspector"]').getByText('Fourth priority').waitFor();
  await noOverflow(page, 'Month (390px)');
  await page.getByRole('button', { name: 'Open day →' }).click();
  await page.getByRole('heading', { name: 'Friday, November 27' }).waitFor();

  // 10. Review view: SVG chart, categories, reflection persistence
  await nav(page, 'Review');
  await page.getByRole('heading', { name: 'Weekly Review' }).waitFor();
  await page.locator('.bar-focus').first().waitFor();
  await page.locator('[data-testid="category-breakdown"]').waitFor();
  await page.getByRole('textbox', { name: 'What went well' }).fill('Shipped daily planner MVP');
  await page.clock.runFor(500);
  await page.locator('[data-testid="reflection-status"]', { hasText: 'Saved' }).waitFor();
  await noOverflow(page, 'Review (390px)');
  await page.screenshot({ path: path.join(OUT, 'review.png'), fullPage: true });
  await page.reload();
  await page.getByRole('heading', { name: 'Weekly Review' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'What went well' }).inputValue(), 'Shipped daily planner MVP');

  // 11. Data view: theme switch, both .ics downloads, backup, erase, bad backup refusal, restore
  await nav(page, 'Data');
  await noOverflow(page, 'Data (390px)');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('corporate');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'corporate');
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('system');
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);

  const [remDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Reminder calendar (.ics)' }).click(),
  ]);
  assert.equal(remDl.suggestedFilename(), 'daily-planner-reminders.ics');

  const [schedDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export schedule (.ics)' }).click(),
  ]);
  assert.equal(schedDl.suggestedFilename(), 'daily-planner-schedule.ics');
  const schedPath = path.join(OUT, schedDl.suggestedFilename());
  await schedDl.saveAs(schedPath);
  const schedText = fs.readFileSync(schedPath, 'utf8');
  assert.match(schedText, /DTSTART:20261125T090000/);
  assert.match(schedText, /SUMMARY:★ Ship Q4\\; budget\\, plan/);

  const [bakDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  assert.equal(bakDl.suggestedFilename(), 'daily-planner-2026-11-25.json');
  const bakPath = path.join(OUT, bakDl.suggestedFilename());
  await bakDl.saveAs(bakPath);

  await page.getByRole('button', { name: 'Erase all data' }).click();
  await page.locator('dialog').getByRole('button', { name: 'Erase' }).click();
  await page.getByText('No tasks planned for this day yet.').waitFor();

  await nav(page, 'Data');
  await page.locator('input[type=file]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"app":"wrong"}'),
  });
  await page.locator('#toast', { hasText: 'not a Daily Planner backup' }).waitFor();

  await page.locator('input[type=file]').setInputFiles(bakPath);
  await page.locator('dialog').getByRole('button', { name: 'Replace' }).click();
  await page.getByRole('heading', { name: 'Today, Nov 25' }).waitFor();
  await page.getByText('Ship Q4; budget, plan').waitFor();

  // 12. 320px narrow phone check across all 5 routes
  await page.setViewportSize({ width: 320, height: 640 });
  for (const tab of ['Today', 'Week', 'Month', 'Review', 'Data']) {
    await nav(page, tab);
    await noOverflow(page, `${tab} (320px)`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav(page, 'Today');

  // 13. Angular Service Worker offline reload
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.getByRole('heading', { name: 'Today, Nov 25' }).waitFor();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('heading', { name: 'Today, Nov 25' }).waitFor();
  await context.setOffline(false);

  // 14. Dark mode screenshot & manifest icon check
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(OUT, 'today-dark.png'), fullPage: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(DIST_ROOT, icon.src)), `${icon.src} missing from dist`);
  }

  assert.deepEqual(errors, [], 'page errors');
  assert.deepEqual(external, [], 'external requests');
  await browser.close();
  server.close();
  console.log('Daily Planner browser E2E + offline test passed.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
