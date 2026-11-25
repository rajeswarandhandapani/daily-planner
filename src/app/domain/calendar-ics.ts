// iCalendar (.ics) exporters for recurring planning reminders and time-blocked tasks.
// Implements RFC 5545 text escaping and 75-octet line folding.

import { makeCalendar } from '../kit/ics';
import { isTime, reminderSummary } from './logic';
import type { PlannerSettings, TaskItem } from './models';

export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Folds a single iCalendar content line to <= 75 UTF-8 octets per RFC 5545 §3.1. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > limit && current.length > 0) {
      parts.push(current);
      current = ` ${ch}`;
      currentBytes = 1 + chBytes;
      limit = 75;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n');
}

export function makeReminderIcs(
  settings: PlannerSettings,
  todayIso: string,
  tasks: readonly TaskItem[] = [],
): string {
  const summary = reminderSummary(tasks, todayIso);
  const raw = makeCalendar({
    prodId: '-//Daily Planner//EN',
    uidPrefix: 'daily-planner-reminder',
    today: todayIso,
    time: settings.reminder.time,
    durationMin: 15,
    days: settings.reminder.days.length ? settings.reminder.days : [1, 2, 3, 4, 5],
    weeks: 12,
    eventFor: () => ({
      title: escapeIcsText(summary.title),
      body: escapeIcsText(summary.body),
    }),
  });
  return raw
    .split('\r\n')
    .map(foldIcsLine)
    .join('\r\n');
}

export function makeScheduleIcs(tasks: readonly TaskItem[], todayIso: string): string {
  const upcoming = tasks
    .filter(t => !t.done && t.date >= todayIso && t.startTime !== null && isTime(t.startTime))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Planner//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const t of upcoming) {
    const dtDate = t.date.replaceAll('-', '');
    const [hh, mm] = (t.startTime as string).split(':');
    const summary = escapeIcsText(t.top3 ? `★ ${t.title}` : t.title);
    const descParts: string[] = [];
    if (t.notes.trim()) descParts.push(t.notes.trim());
    if (t.subtasks.length > 0) {
      descParts.push(t.subtasks.map(s => `${s.done ? '[x]' : '[ ]'} ${s.title}`).join('\n'));
    }
    const description = escapeIcsText(descParts.join('\n\n'));

    lines.push(
      'BEGIN:VEVENT',
      `UID:dp-task-${t.id}@local`,
      `DTSTART:${dtDate}T${hh}${mm}00`,
      `DURATION:PT${Math.max(5, Math.round(t.durationMin))}M`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT5M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${summary}`,
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldIcsLine).join('\r\n');
}
