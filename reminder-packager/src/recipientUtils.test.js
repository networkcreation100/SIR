import { describe, expect, it } from 'vitest';
import { classifyRecipients, classifyRecipientRows, getEmailValidationError, normalizeRecipientRows, rowsFromRecipientText, smartFormatRecipients } from './recipientUtils.js';

describe('recipientUtils', () => {
  it('classifies named email and phone recipients', () => {
    const result = classifyRecipients('Jane Doe <jane@example.com>, Bob 808-783-8800');
    expect(result.values).toEqual(['jane@example.com', '8087838800']);
    expect(result.emails).toEqual(['jane@example.com']);
    expect(result.phones).toEqual(['8087838800']);
    expect(result.labels).toEqual(['Jane Doe — jane@example.com', 'Bob — 8087838800']);
    expect(result.invalid).toEqual([]);
  });

  it('flags email domain mistakes', () => {
    expect(getEmailValidationError('person@gmail')).toContain('valid address');
    expect(getEmailValidationError('person@gmail.com')).toBe('');
  });

  it('expands and deduplicates recipient rows', () => {
    const normalized = normalizeRecipientRows(['jane@example.com, 8087838800, jane@example.com']);
    expect(normalized.rows).toEqual(['jane@example.com', '8087838800']);
    expect(normalized.duplicates).toEqual([]);
  });

  it('keeps row parsing compatible with recipient panel', () => {
    expect(rowsFromRecipientText('Jane <jane@example.com>, 8087838800')).toEqual(['Jane <jane@example.com>', '8087838800']);
    const classified = classifyRecipientRows(['Jane <jane@example.com>', '8087838800']);
    expect(classified.values).toEqual(['jane@example.com', '8087838800']);
    expect(classified.invalid).toEqual([]);
  });

  it('smart formats only when all recipients are valid', () => {
    expect(smartFormatRecipients('Jane jane@example.com')).toBe('Jane <jane@example.com>');
    expect(smartFormatRecipients('not a recipient')).toBe('not a recipient');
  });
});
