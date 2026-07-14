import { formatDue } from './reminderEngine.js';

export const PREVIEW_SETTINGS_KEY = 'sir-preview-settings';
export const PREVIEW_REMINDERS_KEY = 'sir-preview-reminders';
export const PREVIEW_RECIPIENTS_KEY = 'sir-preview-recipients';
export const ISSUE_LOG_KEY = 'sir-issue-log';
export const TIMEZONE_OPTIONS = [
  { code: 'HST', label: 'HST', timeZone: 'Pacific/Honolulu' },
  { code: 'ET', label: 'ET', timeZone: 'America/New_York' },
  { code: 'CT', label: 'CT', timeZone: 'America/Chicago' },
  { code: 'MT', label: 'MT', timeZone: 'America/Denver' },
  { code: 'PT', label: 'PT', timeZone: 'America/Los_Angeles' }
];

export function getTimezoneOption(code = 'HST') {
  return TIMEZONE_OPTIONS.find(item => item.code === code) || TIMEZONE_OPTIONS[0];
}

export function isLocationUnset(location = '') {
  const value = String(location || '').trim().toLowerCase();
  return !value || value === 'no location set';
}

export function formatDueForPreviewTimezone(reminder, timezoneCode) {
  const option = getTimezoneOption(timezoneCode);
  const [year, month, day] = String(reminder.date || '').split('-').map(Number);
  const [hour = 0, minute = 0] = String(reminder.time || '00:00').split(':').map(Number);
  if (!year || !month || !day) return `${formatDue(reminder)} ${option.label}`;
  const wallTime = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return `${new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
  }).format(wallTime)} ${option.label}`;
}

export function readStoredValue(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredValue(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage limits/privacy mode.
  }
}

export function sameReminderCard(a, b) {
  return ['title', 'date', 'time', 'location', 'notes'].every(field => (a?.[field] || '') === (b?.[field] || ''));
}

function getReminderDueTime(reminder) {
  const date = String(reminder?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = /^\d{2}:\d{2}$/.test(String(reminder?.time || '')) ? reminder.time : '23:59';
  const due = new Date(`${date}T${time}:00`);
  return Number.isNaN(due.getTime()) ? null : due.getTime();
}

export function cleanupExpiredLocalReminderData({ now = Date.now(), graceMs = 24 * 60 * 60 * 1000 } = {}) {
  if (typeof window === 'undefined') return [];
  const repairs = [];
  try {
    const rawReminders = window.localStorage.getItem(PREVIEW_REMINDERS_KEY);
    if (rawReminders) {
      const reminders = JSON.parse(rawReminders);
      if (Array.isArray(reminders)) {
        const active = reminders.filter(reminder => {
          const dueTime = getReminderDueTime(reminder);
          return !dueTime || dueTime + graceMs >= now;
        }).slice(0, 7);
        if (active.length !== reminders.length) {
          if (active.length) window.localStorage.setItem(PREVIEW_REMINDERS_KEY, JSON.stringify(active));
          else window.localStorage.removeItem(PREVIEW_REMINDERS_KEY);
          repairs.push('Expired reminder previews were cleared.');
        }
        if (!active.length && window.localStorage.getItem(PREVIEW_RECIPIENTS_KEY)) {
          window.localStorage.removeItem(PREVIEW_RECIPIENTS_KEY);
          repairs.push('Stale recipient preview data was cleared.');
        }
      }
    }
    const rawIssues = window.localStorage.getItem(ISSUE_LOG_KEY);
    if (rawIssues) {
      const issues = JSON.parse(rawIssues);
      if (Array.isArray(issues) && issues.length > 20) {
        window.localStorage.setItem(ISSUE_LOG_KEY, JSON.stringify(issues.slice(0, 20)));
        repairs.push('Old diagnostic entries were trimmed.');
      }
    }
  } catch {
    // Existing normalization handles unreadable values safely.
  }
  return repairs;
}
