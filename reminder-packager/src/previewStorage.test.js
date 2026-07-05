import { beforeEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_REMINDERS_KEY,
  PREVIEW_RECIPIENTS_KEY,
  ISSUE_LOG_KEY,
  cleanupExpiredLocalReminderData,
  formatDueForPreviewTimezone,
  getTimezoneOption,
  readStoredValue,
  writeStoredValue,
} from './previewStorage.js';

describe('preview storage helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears expired reminder previews and stale recipients silently', () => {
    localStorage.setItem(PREVIEW_REMINDERS_KEY, JSON.stringify([
      { title: 'Expired', date: '2020-01-01', time: '09:00' },
    ]));
    localStorage.setItem(PREVIEW_RECIPIENTS_KEY, JSON.stringify(['old@example.com']));

    const repairs = cleanupExpiredLocalReminderData({ now: new Date('2026-07-01T10:00:00').getTime() });

    expect(repairs).toContain('Expired reminder previews were cleared.');
    expect(repairs).toContain('Stale recipient preview data was cleared.');
    expect(localStorage.getItem(PREVIEW_REMINDERS_KEY)).toBeNull();
    expect(localStorage.getItem(PREVIEW_RECIPIENTS_KEY)).toBeNull();
  });

  it('keeps current reminder previews and recipients', () => {
    localStorage.setItem(PREVIEW_REMINDERS_KEY, JSON.stringify([
      { title: 'Future', date: '2026-07-04', time: '09:00' },
    ]));
    localStorage.setItem(PREVIEW_RECIPIENTS_KEY, JSON.stringify(['current@example.com']));

    const repairs = cleanupExpiredLocalReminderData({ now: new Date('2026-07-01T10:00:00').getTime() });

    expect(repairs).toEqual([]);
    expect(JSON.parse(localStorage.getItem(PREVIEW_REMINDERS_KEY))[0].title).toBe('Future');
    expect(JSON.parse(localStorage.getItem(PREVIEW_RECIPIENTS_KEY))).toEqual(['current@example.com']);
  });

  it('trims old diagnostic entries', () => {
    localStorage.setItem(ISSUE_LOG_KEY, JSON.stringify(Array.from({ length: 25 }, (_, index) => ({ index }))));

    const repairs = cleanupExpiredLocalReminderData();

    expect(repairs).toContain('Old diagnostic entries were trimmed.');
    expect(JSON.parse(localStorage.getItem(ISSUE_LOG_KEY))).toHaveLength(20);
  });

  it('reads, writes, and formats preview timezone settings', () => {
    writeStoredValue('sir-test-key', { previewTimezone: 'PT' });

    expect(readStoredValue('sir-test-key', {}).previewTimezone).toBe('PT');
    expect(getTimezoneOption('PT').timeZone).toBe('America/Los_Angeles');
    expect(formatDueForPreviewTimezone({ date: '2026-07-04', time: '18:30' }, 'PT')).toContain('PT');
  });
});
