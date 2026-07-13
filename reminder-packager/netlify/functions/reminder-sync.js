// Synlive reminder sharing — Netlify fallback backend.
// Mirrors the Base44 `reminderSync` function contract so the app can transparently
// fall back to Netlify if Base44 integration credits are exhausted.
//
// Storage: Netlify Blobs (free tier). Each shared reminder is one blob keyed by
// share_token. The 24h expiry is enforced on read/save (record carries expires_at),
// matching the Base44 behavior.

import { getStore } from '@netlify/blobs';

// Bind the Blobs store explicitly. In deployed Netlify Functions the ambient
// context is sometimes deploy/request scoped, which makes a value written in one
// invocation invisible to a later read. Binding with the site ID + an API token
// pins every invocation to the SAME durable store, and consistency:'strong'
// guarantees a read sees a just-written value (read-after-write).
function openStore(name) {
  const siteID = process.env.SIR_BLOBS_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token = process.env.SIR_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_API_TOKEN;
  const opts = { name, consistency: 'strong' };
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
  'access-control-max-age': '86400',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });

const token = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 22);
const nowIso = () => new Date().toISOString();

const TIMEZONE_ALIASES = {
  HST: 'Pacific/Honolulu',
  ET: 'America/New_York',
  CT: 'America/Chicago',
  MT: 'America/Denver',
  PT: 'America/Los_Angeles',
};

function normalizeTimeZone(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Pacific/Honolulu';
  return TIMEZONE_ALIASES[raw] || raw;
}

function offsetMinutesForZone(timeZone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second || '0'),
    );
    return (asUtc - date.getTime()) / 60000;
  } catch {
    return 0;
  }
}

function zonedWallTimeToUtc(dateValue, timeValue = '00:00', timeZoneValue) {
  const [year, month, day] = String(dateValue || '').split('-').map(Number);
  const [hour = 0, minute = 0] = String(timeValue || '00:00').split(':').map(Number);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const timeZone = normalizeTimeZone(timeZoneValue);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = offsetMinutesForZone(timeZone, new Date(wallAsUtc));
  let utcMs = wallAsUtc - offset * 60000;
  const correctedOffset = offsetMinutesForZone(timeZone, new Date(utcMs));
  if (correctedOffset !== offset) utcMs = wallAsUtc - correctedOffset * 60000;
  const due = new Date(utcMs);
  return Number.isNaN(due.getTime()) ? null : due;
}

function expiryIso(payload) {
  const due = payload?.date
    ? zonedWallTimeToUtc(payload.date, payload.time || '00:00', payload.timezone || payload.timeZone || payload.previewTimezone)
    : null;
  if (due) return new Date(due.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return payload?.expires_at || null;
}

function recordExpiryIso(record) {
  return expiryIso(record?.payload) || record?.expires_at || null;
}

function isExpired(record) {
  const expiresAt = recordExpiryIso(record);
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() <= Date.now();
}

function editorFrom(body) {
  return body.editor || body.recipient || 'shared-recipient';
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  let store;
  try {
    store = openStore('sir-reminders');
  } catch (e) {
    return json({ ok: false, error: 'Storage unavailable: ' + (e?.message || e) }, 500);
  }

  try {
    const body = req.method === 'GET' ? { action: 'health' } : await req.json().catch(() => ({}));
    const action = body.action || 'health';

    if (action === 'health') {
      return json({ ok: true, service: 'netlify-reminder-sync', public: true, actions: ['health', 'save', 'fetch', 'event'] });
    }

    if (action === 'save') {
      const payload = body.payload;
      if (!payload || typeof payload !== 'object') return json({ ok: false, error: 'payload is required' }, 400);

      const share_token = body.share_token || payload.share_token || token();
      const incomingVersion = Number(body.version || payload.version || 1);
      const at = nowIso();
      const expires_at = expiryIso(payload);

      const current = await store.get(share_token, { type: 'json', consistency: 'strong' }).catch(() => null);

      if (current && isExpired(current)) {
        await store.delete(share_token).catch(() => {});
        return json({ ok: false, expired: true, message: 'This shared reminder has expired and was removed.' }, 410);
      }
      if (current?.permission === 'view-only') {
        return json({ ok: false, error: 'This shared reminder is view-only.' }, 403);
      }
      if (current && Number(current.version || 0) > incomingVersion) {
        return json({ ok: false, conflict: true, current, message: 'A newer version already exists.' }, 409);
      }

      const editor = editorFrom(body);
      const nextVersion = Math.max(Number(current?.version || 0), incomingVersion) + 1;
      const editEntry = {
        at, editor,
        channel: body.channel || (current ? 'shared-edit' : 'web-share'),
        fields: body.changed_fields || ['date', 'time', 'location', 'locationPin'],
      };
      const edit_history = [...(current?.edit_history || []), editEntry].slice(-100);
      const permission = body.permission || payload.permission || current?.permission || 'shared-edit';
      const payloadWithMeta = { ...payload, share_token, version: nextVersion, permission, expires_at, edit_history };

      const record = {
        share_token,
        payload: payloadWithMeta,
        version: nextVersion,
        permission,
        recipients: body.recipients || payload.recipients || current?.recipients || [],
        last_editor: editor,
        status: body.status || current?.status || 'sent',
        conflict_log: current?.conflict_log || [],
        expires_at,
        edit_history,
        created_date: current?.created_date || at,
        updated_date: at,
        id: current?.id || share_token,
      };

      await store.setJSON(share_token, record);
      return json({ ok: true, reminder: record, share_token, share_url_hint: `?share=${share_token}` });
    }

    if (action === 'fetch') {
      if (!body.share_token) return json({ ok: false, error: 'share_token is required' }, 400);
      const reminder = await store.get(body.share_token, { type: 'json', consistency: 'strong' }).catch(() => null);
      if (!reminder) return json({ ok: false, error: 'Reminder not found' }, 404);
      if (isExpired(reminder)) {
        await store.delete(body.share_token).catch(() => {});
        return json({ ok: false, expired: true, message: 'This shared reminder has expired and was removed.' }, 410);
      }
      return json({ ok: true, reminder });
    }

    if (action === 'event') {
      // Delivery events are best-effort analytics; on the fallback we accept and no-op-store them
      // (keeps the app contract happy without a separate events store).
      if (!body.share_token || !body.event_type) return json({ ok: false, error: 'share_token and event_type are required' }, 400);
      return json({ ok: true, event: { share_token: body.share_token, event_type: body.event_type, occurred_at: nowIso(), stored: false } });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Unexpected server error' }, 500);
  }
};

export const config = { path: '/api/reminder-sync' };
