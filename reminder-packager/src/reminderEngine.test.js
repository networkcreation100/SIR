import { describe, expect, it, vi } from 'vitest';
import { buildStandaloneViewer, createMailto, createSmsLink, decodeReminder, encodeReminder, getStatus, isCircleGesture, makeAttachmentFiles, buildReminderSnapshotSvg, buildReminderMessageBody, normalizeReminder } from './reminderEngine.js';

describe('reminder engine', () => {
  it('normalizes compact reminder payloads', () => {
    const reminder = normalizeReminder({ title: ' Demo ', date: '2026-06-24', time: '09:30', urgency: 'urgent' });
    expect(reminder.title).toBe('Demo');
    expect(reminder.schema).toBe('networkcreation.compact-reminder.v1');
    expect(reminder.version).toBe(1);
    expect(reminder.timezone).toBeTruthy();
  });

  it('encodes and decodes reminders for app/web view handoff', () => {
    const reminder = normalizeReminder({ title: 'Encoded', date: '2026-06-24', time: '09:30' });
    expect(decodeReminder(encodeReminder(reminder)).title).toBe('Encoded');
  });

  it('detects overdue and scheduled reminders', () => {
    expect(getStatus({ date: '2026-06-20', time: '10:00', urgency: 'normal' }, new Date('2026-06-23T10:00:00')).label).toBe('OVERDUE');
    expect(getStatus({ date: '2026-07-20', time: '10:00', urgency: 'normal' }, new Date('2026-06-23T10:00:00')).label).toBe('SCHEDULED');
  });

  it('creates JSON and standalone HTML viewer attachments', () => {
    const reminder = normalizeReminder({ title: 'Attachment Ready', date: '2026-06-24', time: '09:30' });
    const files = makeAttachmentFiles(reminder);
    expect(files).toHaveLength(2);
    expect(files[0].name).toContain('.reminder.json');
    expect(files[1].name).toContain('viewer.html');
    expect(buildStandaloneViewer(reminder)).toContain('Reminder popup');
  });

  it('builds email and sms compose links', () => {
    const reminder = normalizeReminder({ title: 'Sendable', date: '2026-06-24', time: '09:30' });
    expect(createMailto(reminder)).toContain('mailto:');
    expect(createSmsLink(reminder)).toContain('sms:');
    expect(decodeURIComponent(createMailto({ ...reminder, shareUrl: 'https://example.com/?share=test' }))).toContain('Open interactive reminder: https://example.com/?share=test');
    expect(decodeURIComponent(createSmsLink({ ...reminder, shareUrl: 'https://example.com/?share=test' }))).toContain('Open interactive reminder: https://example.com/?share=test');
    expect(buildReminderMessageBody(reminder)).toContain('Reminder: Sendable');
  });

  it('builds a Map Only message that omits schedule/title and keeps the map link', () => {
    const reminder = { ...normalizeReminder({ title: 'Standup', date: '2026-06-24', time: '09:30', location: '123 Main St' }), shareUrl: 'https://example.com/?share=map1' };
    const body = buildReminderMessageBody(reminder, { mapOnly: true });
    expect(body).toContain('Location: 123 Main St');
    expect(body).toContain('Open the interactive map: https://example.com/?share=map1');
    expect(body).not.toContain('Reminder: Standup');
    expect(body).not.toContain('Scheduled:');
    // Links carry the map-only body + subject.
    expect(decodeURIComponent(createMailto(reminder, ['a@b.com'], { mapOnly: true }))).toContain('Shared map location');
    expect(decodeURIComponent(createSmsLink(reminder, ['8085551234'], { mapOnly: true }))).toContain('Open the interactive map:');
  });

  it('recognizes a circular gesture path', () => {
    const points = Array.from({ length: 48 }, (_, i) => {
      const a = (Math.PI * 2 * i) / 47;
      return { x: 100 + Math.cos(a) * 70, y: 100 + Math.sin(a) * 68 };
    });
    expect(isCircleGesture(points)).toBe(true);
    expect(isCircleGesture([{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(false);
  });
});
