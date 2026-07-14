import { describe, expect, it } from 'vitest';
import { classifyRecipients, classifyRecipientRows, normalizeRecipientRows, rowsFromRecipientText, smartFormatRecipients } from './recipientUtils.js';

describe('recipientUtils', () => {
  it('classifies named phone recipients and rejects email recipients', () => {
    const result = classifyRecipients('Jane Doe <jane@example.com>, Bob 808-783-8800');
    expect(result.values).toEqual(['8087838800']);
    expect(result.emails).toEqual([]);
    expect(result.phones).toEqual(['8087838800']);
    expect(result.labels).toEqual(['8087838800']);
    expect(result.invalid).toContain('jane@example.com');
  });

  it('expands and deduplicates phone-only recipient rows', () => {
    const normalized = normalizeRecipientRows(['8087838800', '8087838800']);
    expect(normalized.rows).toEqual(['8087838800']);
    expect(normalized.duplicates).toEqual(['8087838800']);
  });

  it('keeps row parsing compatible with phone-only recipient panel', () => {
    expect(rowsFromRecipientText('Jane <jane@example.com>, 8087838800')).toEqual(['Jane <jane@example.com>', '8087838800']);
    const classified = classifyRecipientRows(['Jane <jane@example.com>', '8087838800']);
    expect(classified.values).toEqual(['8087838800']);
    expect(classified.invalid).toContain('jane@example.com');
  });

  it('smart formats only when all phone recipients are valid', () => {
    expect(smartFormatRecipients('Jane 8087838800')).toBe('Jane <8087838800>');
    expect(smartFormatRecipients('Jane jane@example.com')).toBe('Jane jane@example.com');
    expect(smartFormatRecipients('not a recipient')).toBe('not a recipient');
  });
});
