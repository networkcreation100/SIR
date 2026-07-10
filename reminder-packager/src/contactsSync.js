// Contact auto-sync + auto-suggest for the Send Options recipient field.
//
// Goal: the Recipient field automatically knows the user's contacts (name +
// phone/email) so it can auto-recognize what the user types and auto-fill /
// auto-suggest matching contacts.
//
// Strategy by platform:
//  - Native app (Capacitor): use @capacitor-community/contacts to read the
//    device address book once (with permission) and cache it. This is the real
//    contact list.
//  - Web / PWA: the Contacts API (navigator.contacts.select) is picker-based and
//    cannot silently enumerate contacts, so we can't build a suggestion list from
//    it. We degrade gracefully to an empty suggestion set (typed recognition still
//    works, and the explicit "search contacts" picker remains available elsewhere).

import { Capacitor } from '@capacitor/core';

let cachedContacts = null;      // normalized suggestion entries
let loadPromise = null;         // in-flight load, de-duped
let lastError = '';

function isNative() {
  try { return Capacitor?.isNativePlatform?.() === true; } catch { return false; }
}

// A suggestion entry: { name, value, type: 'phone'|'email', label }
// `label` is what we show in the dropdown; `value` is what we fill in.
function makeEntry(name, value, type) {
  const cleanName = (name || '').trim();
  const cleanValue = (value || '').trim();
  if (!cleanValue) return null;
  const label = cleanName ? `${cleanName} — ${cleanValue}` : cleanValue;
  const fill = cleanName ? `${cleanName} ${cleanValue}` : cleanValue;
  return { name: cleanName, value: cleanValue, type, label, fill };
}

function isEmailLike(v) {
  return /@/.test(String(v || ''));
}

async function loadNativeContacts() {
  // Dynamically import so web builds never bundle-fail if the plugin is absent.
  let Contacts;
  try {
    ({ Contacts } = await import('@capacitor-community/contacts'));
  } catch {
    lastError = 'Contacts plugin unavailable.';
    return [];
  }
  try {
    const perm = await Contacts.requestPermissions();
    const granted = perm?.contacts === 'granted' || perm?.contacts === 'limited';
    if (!granted) { lastError = 'Contacts permission not granted.'; return []; }

    const result = await Contacts.getContacts({
      projection: { name: true, phones: true, emails: true },
    });
    const list = result?.contacts || [];
    const entries = [];
    for (const c of list) {
      const name = c?.name?.display
        || [c?.name?.given, c?.name?.family].filter(Boolean).join(' ')
        || '';
      for (const p of (c?.phones || [])) {
        const e = makeEntry(name, p?.number, 'phone');
        if (e) entries.push(e);
      }
      for (const em of (c?.emails || [])) {
        const e = makeEntry(name, em?.address, 'email');
        if (e) entries.push(e);
      }
    }
    lastError = '';
    return dedupe(entries);
  } catch (err) {
    lastError = err?.message || 'Could not read contacts.';
    return [];
  }
}

function dedupe(entries) {
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = `${e.type}:${e.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  // Sort by name (named first, alpha), then value.
  out.sort((a, b) => {
    if (!!a.name !== !!b.name) return a.name ? -1 : 1;
    return (a.name || a.value).localeCompare(b.name || b.value);
  });
  return out;
}

// Public: ensure contacts are synced. Safe to call repeatedly; caches result.
// Returns the suggestion entries (possibly empty).
export async function syncContacts({ force = false } = {}) {
  if (!force && cachedContacts) return cachedContacts;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const entries = isNative() ? await loadNativeContacts() : [];
    cachedContacts = entries;
    loadPromise = null;
    return entries;
  })();
  return loadPromise;
}

// Public: current cached contacts without triggering a load.
export function getCachedContacts() {
  return cachedContacts || [];
}

export function getContactsError() {
  return lastError;
}

export function contactsSupported() {
  return isNative();
}

// Public: given the text the user is typing in a recipient row, return the best
// matching contact suggestions. Matches against name, phone, and email.
export function suggestContacts(query, limit = 6) {
  const entries = getCachedContacts();
  if (!entries.length) return [];
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const digits = q.replace(/[^\d]/g, '');
  const scored = [];
  for (const e of entries) {
    const name = e.name.toLowerCase();
    const value = e.value.toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 100;
    else if (name.includes(q)) score = 70;
    else if (value.startsWith(q)) score = 60;
    else if (value.includes(q)) score = 40;
    if (score < 0 && digits && e.type === 'phone') {
      const valDigits = value.replace(/[^\d]/g, '');
      if (valDigits.startsWith(digits)) score = 55;
      else if (valDigits.includes(digits)) score = 35;
    }
    if (score >= 0) scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.e);
}
