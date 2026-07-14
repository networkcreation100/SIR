// nativeNotify.js
// Native local-notification + app-badge helper for the SAGE app.
//
// Responsibilities:
//   1. Schedule a local notification 15 minutes BEFORE a reminder's
//      meeting/appointment time (and, if that lead time has already passed
//      but the meeting is still in the future, fire immediately/at meeting time).
//   2. Keep an app-icon badge count in sync with how many upcoming reminders
//      are pending (badge app icons / notification badges).
//
// Web / PWA has no reliable equivalent, so every function is a no-op unless we
// are running inside a Capacitor native shell (Android / iOS). The module lazy-
// imports @capacitor/core and @capacitor/local-notifications exactly like
// nativeSpeech.js so the web build never pulls the native plugin at runtime.

let capacitorRef = null;
let LocalNotifications = null;
let loadTried = false;

const NATIVE_NOTIFY_TIMEOUT_MS = 1400;

function withNativeTimeout(promise, fallback, timeoutMs = NATIVE_NOTIFY_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise(resolve => { timer = setTimeout(() => resolve(fallback), timeoutMs); })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

async function loadPlugin() {
  if (loadTried) return LocalNotifications;
  loadTried = true;
  try {
    const core = await import('@capacitor/core');
    capacitorRef = core.Capacitor;
    if (!capacitorRef || !capacitorRef.isNativePlatform || !capacitorRef.isNativePlatform()) {
      return null; // web / PWA — no native notifications
    }
    const mod = await import('@capacitor/local-notifications');
    LocalNotifications = mod.LocalNotifications;
  } catch (err) {
    // Plugin not present (e.g. web build) — silently disable.
    LocalNotifications = null;
  }
  return LocalNotifications;
}

export function isNativeNotifyAvailable() {
  try {
    return !!(capacitorRef && capacitorRef.isNativePlatform && capacitorRef.isNativePlatform() && LocalNotifications);
  } catch {
    return false;
  }
}

// Ask for notification permission once. Returns true if granted.
export async function ensureNotifyPermission() {
  const plugin = await loadPlugin();
  if (!plugin) return false;
  try {
    let perm = await withNativeTimeout(plugin.checkPermissions(), { display: 'denied', reason: 'check-timeout' });
    if (perm.display !== 'granted') {
      perm = await withNativeTimeout(plugin.requestPermissions(), { display: 'denied', reason: 'request-timeout' });
    }
    return perm.display === 'granted';
  } catch {
    return false;
  }
}

const LEAD_MS = 15 * 60 * 1000; // 15 minutes before the meeting time

// Build a stable positive 32-bit notification id from a reminder id/token.
function notifId(key) {
  const s = String(key || 'sir');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) & 0x7fffffff;
  }
  // keep it comfortably inside signed-32-bit and non-zero
  return (h % 2000000000) + 1;
}

function parseWhen(dateStr, timeStr) {
  if (!dateStr) return null;
  const t = timeStr && /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr : '00:00';
  const when = new Date(`${dateStr}T${t}`);
  return isNaN(when.getTime()) ? null : when;
}

/**
 * Schedule (or reschedule) the 15-minute-before notification for one reminder.
 * @param {object} reminder - { id|share_token, title, date 'YYYY-MM-DD', time 'HH:MM', location }
 * @returns {Promise<{scheduled:boolean, at?:string, id?:number, reason?:string}>}
 */
export async function scheduleReminderNotification(reminder) {
  const plugin = await loadPlugin();
  if (!plugin) return { scheduled: false, reason: 'not-native' };

  const granted = await ensureNotifyPermission();
  if (!granted) return { scheduled: false, reason: 'no-permission' };

  const key = reminder?.id || reminder?.share_token || reminder?.title || 'sir';
  const id = notifId(key);
  const meetingAt = parseWhen(reminder?.date, reminder?.time);
  if (!meetingAt) return { scheduled: false, reason: 'no-time' };

  const now = Date.now();
  const meetingMs = meetingAt.getTime();
  if (meetingMs <= now) {
    // Meeting already passed — clear any stale scheduled notification.
    try { await withNativeTimeout(plugin.cancel({ notifications: [{ id }] }), null); } catch {}
    return { scheduled: false, reason: 'past' };
  }

  // Fire 15 min before; if that moment is already in the past (reminder created
  // within the last 15 min), fire ~now instead so the user still gets alerted.
  let fireAt = new Date(meetingMs - LEAD_MS);
  if (fireAt.getTime() <= now) fireAt = new Date(now + 5000);

  const title = reminder?.title && reminder.title.trim() ? reminder.title.trim() : 'Upcoming reminder';
  const loc = reminder?.location ? ` · ${reminder.location}` : '';
  const minsLeft = Math.max(1, Math.round((meetingMs - fireAt.getTime()) / 60000));

  try {
    // Replace any existing schedule for this reminder first.
    try { await withNativeTimeout(plugin.cancel({ notifications: [{ id }] }), null); } catch {}
    const scheduleResult = await withNativeTimeout(plugin.schedule({
      notifications: [{
        id,
        title,
        body: `Starts in ${minsLeft} min${loc}`,
        schedule: { at: fireAt, allowWhileIdle: true },
        smallIcon: 'ic_launcher_foreground',
        // The number sets/updates the app-icon badge when the notification fires.
        extra: { key: String(key), meetingAt: meetingAt.toISOString() }
      }]
    }), { timedOut: true });
    if (scheduleResult?.timedOut) return { scheduled: false, reason: 'schedule-timeout', id };
    await refreshBadgeCount(plugin);
    return { scheduled: true, at: fireAt.toISOString(), id };
  } catch (err) {
    return { scheduled: false, reason: 'schedule-error', error: String(err) };
  }
}

// Cancel a single reminder's scheduled notification.
export async function cancelReminderNotification(key) {
  const plugin = await loadPlugin();
  if (!plugin) return;
  const id = notifId(key);
  try { await withNativeTimeout(plugin.cancel({ notifications: [{ id }] }), null); } catch {}
  try { await refreshBadgeCount(plugin); } catch {}
}

// Count still-pending scheduled notifications and reflect that on the app badge.
async function refreshBadgeCount(plugin) {
  try {
    const pending = await withNativeTimeout(plugin.getPending(), { notifications: [] });
    const count = (pending?.notifications || []).length;
    // On iOS the badge is set by the notification itself; explicitly keep the
    // app icon badge in sync with the pending count so it clears correctly.
    if (plugin.setBadge) {
      await withNativeTimeout(plugin.setBadge({ count }).catch(() => {}), null);
    }
    return count;
  } catch {
    return 0;
  }
}

// Public helper to force-refresh the badge (e.g. on app resume).
export async function syncAppBadge() {
  const plugin = await loadPlugin();
  if (!plugin) return 0;
  return refreshBadgeCount(plugin);
}


// Fire an immediate native notification when a newer app update is available.
// Web/PWA safely no-ops via loadPlugin(), matching the reminder notification flow.
export async function notifyAppUpdateAvailable(updateInfo = {}) {
  const plugin = await loadPlugin();
  if (!plugin) return { sent: false, reason: 'not-native' };
  const granted = await ensureNotifyPermission();
  if (!granted) return { sent: false, reason: 'no-permission' };
  const version = String(updateInfo.latestVersion || updateInfo.version || 'new');
  const id = notifId(`sir-update-${version}`);
  const title = updateInfo.title || 'SAGE update available';
  const body = updateInfo.message || `Version ${version} is ready to download.`;
  try {
    try { await plugin.cancel({ notifications: [{ id }] }); } catch {}
    await plugin.schedule({
      notifications: [{
        id,
        title,
        body,
        schedule: { at: new Date(Date.now() + 1000), allowWhileIdle: true },
        smallIcon: 'ic_launcher_foreground',
        iconColor: '#dc2626',
        extra: { type: 'app-update', version, downloadUrl: updateInfo.downloadUrl || '' }
      }]
    });
    return { sent: true, id };
  } catch (err) {
    return { sent: false, reason: 'schedule-error', error: String(err) };
  }
}
