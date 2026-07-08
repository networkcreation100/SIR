export const COMMON_EMAIL_DOMAIN_FIXES = {
  'hotmail.co': 'hotmail.com',
  'outlook.co': 'outlook.com',
  'gmail.co': 'gmail.com',
  'yahoo.co': 'yahoo.com',
  'icloud.co': 'icloud.com'
};

export function getEmailValidationError(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return 'Email must include a valid address and domain.';
  const domain = email.split('@')[1] || '';
  if (COMMON_EMAIL_DOMAIN_FIXES[domain]) return `Did you mean ${COMMON_EMAIL_DOMAIN_FIXES[domain]}?`;
  const [local] = email.split('@');
  if (!local || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return 'Email username looks incomplete.';
  return '';
}

export function isEmail(value) { return !getEmailValidationError(value); }
export function isPhone(value) {
  const text = String(value || '').trim();
  if (!/^\+?[0-9\s().-]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return digits.length >= 8 && digits.length <= 15;
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

export function dedupeRecipients(values) {
  const seen = new Set();
  return values.filter(value => {
    const key = value.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanRecipientName(value = '') {
  return String(value)
    .replace(/[<>]/g, ' ')
    .replace(/^(?:and|to|for|recipient|name)\s*:?\s*/i, '')
    .replace(/[\s,:;\-–—]+$/g, ' ')
    .replace(/^[\s,:;\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSafeRecipientName(value = '') {
  const name = cleanRecipientName(value);
  return /^[A-Za-z][A-Za-z'. ]{1,60}$/.test(name) && /[A-Za-z]{2,}/.test(name) && !/@|\d/.test(name);
}

export function splitInvalidRecipientText(value = '') {
  return String(value)
    .split(/[,;\n]+/)
    .map(item => item.trim())
    .filter(item => item && !/^[,;\s<>\-–—]+$/.test(item));
}


export function normalizePhoneRecipientValue(value = '') {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length >= 7) return text.trim().startsWith('+') ? `+${digits}` : digits;
  return text;
}

export function formatRecipientLabel(contact) {
  return contact.name ? `${contact.name} — ${contact.value}` : contact.value;
}

export function formatRecipientInput(contact) {
  return contact.name ? `${contact.name} <${contact.value}>` : contact.value;
}

export function classifyRecipients(input = '') {
  const source = String(input || '');
  const emailPattern = /[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/gi;
  const emailMatches = Array.from(source.matchAll(emailPattern)).map(match => ({ value: match[0].trim(), index: match.index || 0, end: (match.index || 0) + match[0].length, type: 'email' }));
  const masked = source.replace(emailPattern, match => ' '.repeat(match.length));
  const phonePattern = /\+?\d[\d\s().-]{5,}\d/g;
  const phoneMatches = Array.from(masked.matchAll(phonePattern)).map(match => ({ value: match[0].replace(/\s+/g, ' ').trim(), index: match.index || 0, end: (match.index || 0) + match[0].length, type: 'phone' }));
  const matches = [...emailMatches, ...phoneMatches].sort((a, b) => a.index - b.index);

  if (!matches.length) {
    const chunks = splitInvalidRecipientText(source);
    return { values: [], phones: [], emails: [], invalid: dedupeRecipients(chunks), contacts: [], labels: [] };
  }

  const contacts = [];
  const invalid = [];
  let previousEnd = 0;

  matches.forEach(match => {
    const rawNameSegment = source.slice(previousEnd, match.index);
    const candidateName = cleanRecipientName(rawNameSegment);
    const hasCandidateText = splitInvalidRecipientText(rawNameSegment).length > 0;
    if (hasCandidateText && !isSafeRecipientName(candidateName)) invalid.push(...splitInvalidRecipientText(rawNameSegment));
    contacts.push({
      value: match.type === 'phone' ? normalizePhoneRecipientValue(match.value) : match.value,
      type: match.type,
      name: isSafeRecipientName(candidateName) ? candidateName : '',
      label: ''
    });
    previousEnd = match.end;
  });

  const trailing = source.slice(previousEnd);
  if (splitInvalidRecipientText(trailing).length) invalid.push(...splitInvalidRecipientText(trailing));

  const dedupedContacts = [];
  const seen = new Set();
  contacts.forEach(contact => {
    const key = contact.value.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) return;
    seen.add(key);
    const safe = { ...contact };
    safe.label = formatRecipientLabel(safe);
    dedupedContacts.push(safe);
  });

  const values = dedupedContacts.map(contact => contact.value);
  const phones = values.filter(isPhone);
  const emails = values.filter(value => !isPhone(value) && isEmail(value));
  const recognizedInvalid = values.filter(value => !isPhone(value) && !isEmail(value));
  return {
    values,
    phones,
    emails,
    invalid: dedupeRecipients([...invalid, ...recognizedInvalid]),
    contacts: dedupedContacts,
    labels: dedupedContacts.map(formatRecipientLabel)
  };
}

export function smartFormatRecipients(input) {
  const classified = classifyRecipients(input);
  if (!classified.values.length || classified.invalid.length) return input;
  return classified.contacts.map(formatRecipientInput).join(', ');
}


export function rowsFromRecipientText(text = '') {
  const value = String(text || '').trim();
  if (!value) return [''];
  const classified = classifyRecipients(value);
  if (classified.values.length && !classified.invalid.length) return classified.contacts.map(formatRecipientInput);
  return value.split(/[,;\n]+/).map(item => item.trim()).filter(Boolean);
}

export function classifyRecipientRows(rows = []) {
  const invalid = [];
  const contacts = [];
  const duplicates = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    const text = String(row || '').trim();
    if (!text) return;
    const classified = classifyRecipients(text);
    if (classified.values.length !== 1 || classified.invalid.length) {
      invalid.push(...(classified.invalid.length ? classified.invalid : [`Row ${index + 1} has more than one contact.`]));
      return;
    }
    const contact = classified.contacts[0];
    const key = contact.value.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) {
      duplicates.push(formatRecipientLabel(contact));
      return;
    }
    seen.add(key);
    contacts.push(contact);
  });

  const values = contacts.map(contact => contact.value);
  const phones = values.filter(isPhone);
  const emails = values.filter(value => !isPhone(value) && isEmail(value));
  const recognizedInvalid = values.filter(value => !isPhone(value) && !isEmail(value));
  return {
    values,
    phones,
    emails,
    invalid: dedupeRecipients([...invalid, ...recognizedInvalid]),
    contacts,
    labels: contacts.map(formatRecipientLabel),
    duplicates
  };
}

export function normalizeRecipientRows(rows = []) {
  const expanded = [];
  rows.forEach(row => {
    const value = String(row || '').trim();
    if (!value) return;
    const classified = classifyRecipients(value);
    if (classified.values.length > 1) expanded.push(...classified.contacts.map(formatRecipientInput));
    else expanded.push(value);
  });
  const deduped = [];
  const duplicates = [];
  const seen = new Set();
  expanded.forEach(row => {
    const classified = classifyRecipients(row);
    const keyValue = classified.values.length === 1 && !classified.invalid.length ? classified.values[0] : row;
    const key = keyValue.toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) {
      duplicates.push(row);
      return;
    }
    seen.add(key);
    deduped.push(row);
  });
  return { rows: deduped.length ? deduped : [''], duplicates };
}
