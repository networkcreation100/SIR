import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createMailto, createSmsLink, formatDue, getStatus, makeAttachmentFiles, buildReminderSnapshotSvg, buildReminderMessageBody, normalizeReminder, urgencyLevels, isCircleGesture } from './reminderEngine.js';
import './styles.css';
import { AlertTriangle, Bell, CalendarClock, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, LocateFixed, Maximize2, Minimize2, MapPin, Mic, RefreshCw, Mail, MessageCircle, Heart, ShieldCheck, Settings2, Send, Smartphone, Sparkles, X } from './icons.jsx';
import { PREVIEW_SETTINGS_KEY, PREVIEW_REMINDERS_KEY, PREVIEW_RECIPIENTS_KEY, ISSUE_LOG_KEY, TIMEZONE_OPTIONS, isLocationUnset, formatDueForPreviewTimezone, readStoredValue, writeStoredValue, sameReminderCard, cleanupExpiredLocalReminderData } from './previewStorage.js';
import { getEmailValidationError, isEmail, isPhone, classifyRecipients, smartFormatRecipients, rowsFromRecipientText, classifyRecipientRows, normalizeRecipientRows } from './recipientUtils.js';
import { startNativeSpeech, isNativePlatform } from './nativeSpeech.js';
import { scheduleReminderNotification, ensureNotifyPermission, syncAppBadge } from './nativeNotify.js';

const PrivacyStatementPopup = React.lazy(() => import('./settingsPopups.jsx').then(m => ({ default: m.PrivacyStatementPopup })));
const ContactSupportPopup = React.lazy(() => import('./settingsPopups.jsx').then(m => ({ default: m.ContactSupportPopup })));
const PremiumMembershipPopup = React.lazy(() => import('./settingsPopups.jsx').then(m => ({ default: m.PremiumMembershipPopup })));

const placeholderReminderTitle = 'Meeting at the bar';
const REMINDER_SYNC_URL = 'https://superagent-934909c8.base44.app/functions/reminderSync';
const ROUTE_PROXY_URL = 'https://superagent-934909c8.base44.app/functions/sirRouteProxy';
// Permanent PUBLIC web page that renders a shared reminder from its ?share= token.
// Share links MUST point here — never at the app's own origin. In the published
// native app window.location is an internal Capacitor origin (Android
// https://localhost/, iOS capacitor://localhost/), so a link built from it opens
// nothing on the recipient's phone. That is why recipient reminders worked in the
// browser/tunnel test but failed after publishing to the stores.
const PUBLIC_SHARE_BASE = 'https://networkcreation100.github.io/SIR/';

function isInternalAppOrigin() {
  try {
    if (isNativePlatform && isNativePlatform()) return true;
    const h = (window.location && window.location.hostname) || '';
    const proto = (window.location && window.location.protocol) || '';
    // Capacitor / file / localhost origins cannot be opened by a remote recipient.
    return proto === 'capacitor:' || proto === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '';
  } catch {
    return true;
  }
}

function buildShareUrl(shareToken) {
  // Published native app (or any non-public origin): always use the permanent
  // public web page so the recipient's link actually resolves on their device.
  if (isInternalAppOrigin()) {
    const url = new URL(PUBLIC_SHARE_BASE);
    url.searchParams.set('share', shareToken);
    return url.toString();
  }
  // Web/dev/tunnel: keep using the current public origin so live testing works.
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', shareToken);
  return url.toString();
}

function buildPreviewImageUrl(shareToken) {
  return `https://superagent-934909c8.base44.app/functions/sirReminderPreviewImage?token=${encodeURIComponent(shareToken)}`;
}

function escapeHtmlAttribute(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let leafletPromise;
function loadLeaflet() {
  if (!leafletPromise) {
    leafletPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([module]) => module.default || module);
  }
  return leafletPromise;
}

/* ---- Two-map view synchronization ----
   Both the Zoom-Out (role 'out') and Zoom-In (role 'in') maps stay fully
   interactive. When the user pans/zooms one, we mirror the center to the other
   and offset its zoom (ZOOM_OFFSET) so 'out' stays wider and 'in' stays closer,
   while still adjusting dynamically. An `applying` guard prevents feedback loops. */
function registerSyncMap(bus, role, mapInstance, L) {
  if (!bus || !mapInstance) return;
  bus.maps = bus.maps || {};

  // Re-registration can happen when compact pin-picker/edit mode toggles.
  // Always detach any stale handler first so map events don't stack and echo.
  if (mapInstance.__syncHandler) {
    mapInstance.off('moveend', mapInstance.__syncHandler);
    mapInstance.off('zoomend', mapInstance.__syncHandler);
    delete mapInstance.__syncHandler;
  }

  bus.maps[role] = mapInstance;
  if (typeof bus.ZOOM_OFFSET !== 'number') bus.ZOOM_OFFSET = 4;

  const otherRole = role === 'out' ? 'in' : 'out';
  const handler = () => {
    if (bus.applying) return;
    const other = bus.maps?.[otherRole];
    if (!other) return;
    bus.applying = true;
    try {
      const center = mapInstance.getCenter();
      const zoom = mapInstance.getZoom();
      // Intended modes: Zoom-In stays closer than Zoom-Out by ZOOM_OFFSET.
      const targetZoom = otherRole === 'in' ? zoom + bus.ZOOM_OFFSET : zoom - bus.ZOOM_OFFSET;
      const clamped = Math.max(other.getMinZoom(), Math.min(other.getMaxZoom(), targetZoom));
      other.setView(center, clamped, { animate: false });
    } finally {
      // Release on next tick so the mirrored map's own events don't echo back.
      setTimeout(() => { bus.applying = false; }, 0);
    }
  };
  mapInstance.__syncHandler = handler;
  mapInstance.on('moveend', handler);
  mapInstance.on('zoomend', handler);
}

function unregisterSyncMap(bus, role) {
  if (!bus || !bus.maps) return;
  const mapInstance = bus.maps[role];
  if (mapInstance && mapInstance.__syncHandler) {
    mapInstance.off('moveend', mapInstance.__syncHandler);
    mapInstance.off('zoomend', mapInstance.__syncHandler);
    delete mapInstance.__syncHandler;
  }
  delete bus.maps[role];
}

function buildHtmlEmailBody(reminder) {
  const title = escapeHtmlAttribute(reminder.title || 'Reminder');
  const due = escapeHtmlAttribute(formatDue(reminder));
  const location = escapeHtmlAttribute(reminder.location || 'No location set');
  const link = escapeHtmlAttribute(reminder.shareUrl || '');
  return `<div style="font-family:Arial,sans-serif;color:#111827;line-height:1.45">
    <p style="margin:0 0 12px 0;color:#374151">Tap the reminder preview card to open the interactive reminder.</p>
    <a href="${link}" style="display:block;text-decoration:none;border:0;color:inherit" target="_blank" rel="noopener">
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="420" style="width:100%;max-width:420px;border-collapse:separate;border-spacing:0;background:#ffffff;border:3px solid #22c55e;border-radius:24px;box-shadow:0 10px 26px rgba(15,23,42,.14);overflow:hidden">
        <tr><td style="padding:22px 22px 10px 22px;font-size:28px;font-weight:800;color:#111827">${title}</td></tr>
        <tr><td style="padding:0 22px 14px 22px">
          <div style="background:#ecfdf5;border:3px solid #60a5fa;border-radius:18px;padding:14px 16px;font-size:20px;font-weight:800;color:#15803d">${due}</div>
        </td></tr>
        <tr><td style="padding:0 22px 18px 22px;font-size:16px;font-weight:700;color:#64748b">📍 ${location}</td></tr>
        <tr><td style="padding:0 22px 22px 22px">
          <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:18px;padding:16px;text-align:center;color:#64748b;font-size:15px;font-weight:700">
            Interactive reminder preview · schedule/location editable
          </div>
        </td></tr>
        <tr><td style="padding:0 22px 24px 22px">
          <div style="background:#f3f4f6;border-radius:16px;padding:14px;text-align:center;color:#111827;font-size:16px;font-weight:800">Open interactive reminder</div>
        </td></tr>
      </table>
    </a>
  </div>`;
}
function buildOutlookComposeUrl(reminder, recipients) {
  const url = new URL('https://outlook.live.com/mail/0/deeplink/compose');
  url.searchParams.set('to', recipients.join(';'));
  url.searchParams.set('subject', `Reminder: ${reminder.title}`);
  url.searchParams.set('body', buildHtmlEmailBody(reminder));
  return url.toString();
}

function openHtmlEmailCompose(reminder, recipients) {
  const composeUrl = buildOutlookComposeUrl(reminder, recipients);
  window.__lastSirComposeUrl = composeUrl;
  const opened = window.open(composeUrl, '_blank', 'noopener,noreferrer');
  if (!opened) window.location.href = composeUrl;
  return composeUrl;
}

async function makeReminderSnapshotImageDataUrl(reminder) {
  const svg = buildReminderSnapshotSvg(reminder);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 820;
    canvas.height = 1180;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function snapshotFilename(reminder) {
  const base = (reminder.title || 'reminder').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'reminder';
  return `${base}-preview.png`;
}

async function makeReminderSnapshotPngFile(reminder) {
  const svg = buildReminderSnapshotSvg(reminder);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
  const objectUrl = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 820;
    canvas.height = 1180;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const pngBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.92));
    if (!pngBlob) throw new Error('Screenshot preview could not be generated.');
    return new File([pngBlob], snapshotFilename(reminder), { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function shareReminderSnapshotFile(reminder) {
  const nativeShare = navigator.share?.bind(navigator);
  if (!nativeShare) return false;
  const file = await makeReminderSnapshotPngFile(reminder);
  const nativeCanShare = navigator.canShare?.bind(navigator);
  if (nativeCanShare && !nativeCanShare({ files: [file] })) return false;
  await nativeShare({
    title: `Reminder: ${reminder.title}`,
    text: buildReminderMessageBody(reminder),
    files: [file]
  });
  return true;
}


function formatChangeTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function formatEditorName(value) {
  if (!value) return 'shared recipient';
  return String(value).replace(/[-_]/g, ' ');
}

async function reminderSync(body) {
  const response = await fetch(REMINDER_SYNC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.message || data.error || 'Reminder sync failed');
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

async function attachHostedPreviewImage(sharedReminder, token, currentVersion) {
  const previewImageDataUrl = await makeReminderSnapshotImageDataUrl(sharedReminder);
  const payloadWithPreview = { ...sharedReminder, previewImageDataUrl, version: currentVersion || sharedReminder.version || 1 };
  await reminderSync({
    action: 'save',
    share_token: token,
    version: currentVersion || sharedReminder.version || 1,
    editor: sharedReminder.sender || 'sender',
    channel: 'preview-image',
    recipients: sharedReminder.recipients || [],
    payload: payloadWithPreview,
    changed_fields: ['previewImageDataUrl']
  });
  return { ...payloadWithPreview, previewImageUrl: buildPreviewImageUrl(token) };
}


const initialReminder = { ...normalizeReminder({
  title: placeholderReminderTitle,
  date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  time: '17:03',
  location: '',
  milestone: '',
  urgency: 'low',
  notes: '',
  sender: 'Networkcreation',
  locationPin: null,
  urgencySelected: false
}), title: '', location: '', urgencySelected: false };

const BACKGROUND_BLANK_REMINDER_ID = 'sir-preview-background-blank';

function isBlankPreviewCard(reminder) {
  const title = String(reminder?.title || '').trim();
  return (!title || title === placeholderReminderTitle) && isLocationUnset(reminder?.location) && !String(reminder?.notes || '').trim() && !reminder?.locationPin;
}



function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function compactIssueMessage(value = '') {
  return String(value || 'Unknown issue').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function readIssueLog() {
  const log = readStoredValue(ISSUE_LOG_KEY, []);
  return Array.isArray(log) ? log.slice(0, 20) : [];
}

function recordClientIssue(type, message, detail = {}) {
  if (typeof window === 'undefined') return null;
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    type,
    message: compactIssueMessage(message),
    detail,
    occurredAt: new Date().toISOString(),
    path: window.location?.pathname || '/',
    userAgent: window.navigator?.userAgent || 'unknown'
  };
  writeStoredValue(ISSUE_LOG_KEY, [entry, ...readIssueLog()].slice(0, 20));
  return entry;
}

function normalizeReminderList(value) {
  if (!Array.isArray(value)) return { value: [initialReminder], repaired: true, reason: 'Reminder preview list was not readable.' };
  const normalized = value
    .filter(isPlainObject)
    .map(item => normalizeReminder({ ...item, title: typeof item.title === 'string' ? item.title : '' }))
    .slice(0, 7);
  if (!normalized.length) return { value: [initialReminder], repaired: true, reason: 'Reminder preview list was empty or invalid.' };
  return { value: normalized, repaired: normalized.length !== value.length, reason: 'Removed invalid reminder preview entries.' };
}

function normalizePreviewSettings(value) {
  if (!isPlainObject(value)) return { value: { showRecipientsInPreview: false, activeIndex: 0, previewTimezone: 'HST', displayMode: 'compact' }, repaired: true, reason: 'Preview settings were not readable.' };
  const safe = {
    showRecipientsInPreview: Boolean(value.showRecipientsInPreview),
    activeIndex: Number.isFinite(Number(value.activeIndex)) && Number(value.activeIndex) >= 0 ? Number(value.activeIndex) : 0,
    previewTimezone: TIMEZONE_OPTIONS.some(option => option.code === value.previewTimezone) ? value.previewTimezone : 'HST',
    displayMode: value.displayMode === 'standard' ? 'standard' : 'compact'
  };
  return { value: safe, repaired: JSON.stringify(safe) !== JSON.stringify(value), reason: 'Preview settings were corrected.' };
}

function normalizeRecipientList(value) {
  if (!Array.isArray(value)) return { value: [], repaired: true, reason: 'Recipient preview list was not readable.' };
  const safe = value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 20);
  return { value: safe, repaired: JSON.stringify(safe) !== JSON.stringify(value), reason: 'Recipient preview list was cleaned.' };
}

function inspectAndRepairStoredState({ manual = false } = {}) {
  if (typeof window === 'undefined') return { repairs: [], issues: [], manual, checkedAt: new Date().toISOString() };
  const repairs = [];
  const cleanupRepairs = cleanupExpiredLocalReminderData();
  if (manual) repairs.push(...cleanupRepairs);
  else if (cleanupRepairs.length) recordClientIssue('silent-cleanup', cleanupRepairs.join(' '), { repairs: cleanupRepairs });
  const checks = [
    { key: PREVIEW_REMINDERS_KEY, fallback: [initialReminder], normalize: normalizeReminderList },
    { key: PREVIEW_SETTINGS_KEY, fallback: { showRecipientsInPreview: false, activeIndex: 0, previewTimezone: 'HST', displayMode: 'compact' }, normalize: normalizePreviewSettings },
    { key: PREVIEW_RECIPIENTS_KEY, fallback: [], normalize: normalizeRecipientList }
  ];
  for (const check of checks) {
    const before = readStoredValue(check.key, check.fallback);
    const result = check.normalize(before);
    if (result.repaired) {
      writeStoredValue(check.key, result.value);
      repairs.push(result.reason);
    }
  }
  if (repairs.length) recordClientIssue('self-repair', repairs.join(' '), { repairs });
  return { repairs, issues: readIssueLog(), manual, checkedAt: new Date().toISOString() };
}

function SelfRepairPanel({ report, runtimeIssue, onRunCheck, onReset, onDismiss }) {
  const repairs = report?.repairs || [];
  const issueCount = report?.issues?.length || 0;
  const shouldShow = runtimeIssue || report?.manual;
  if (!shouldShow) return null;
  return <section className="self-repair-panel" role="status" aria-live="polite">
    <div>
      <p className="eyebrow tiny"><Sparkles size={13}/> Self-correction</p>
      <h2>{runtimeIssue ? 'I found an issue and can repair this session.' : repairs.length ? 'I corrected app state automatically.' : 'Self-check passed.'}</h2>
      <p>{runtimeIssue ? runtimeIssue.message : repairs.length ? repairs.join(' ') : 'No broken reminder data, preview settings, or recipient state found.'}</p>
      {issueCount > 0 && <small>{issueCount} recent issue{issueCount === 1 ? '' : 's'} kept locally to help spot recurring problems.</small>}
    </div>
    <div className="self-repair-actions">
      <button type="button" className="secondary" onClick={onRunCheck}>Run self-check</button>
      <button type="button" className="ghost" onClick={onReset}>Reset local data</button>
      <button type="button" className="ghost" onClick={onDismiss}>Dismiss</button>
    </div>
  </section>;
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    recordClientIssue('render-error', error?.message || error, { componentStack: info?.componentStack || '' });
  }
  repairAndReload = () => {
    inspectAndRepairStoredState({ manual: true });
    window.location.reload();
  };
  resetAndReload = () => {
    [PREVIEW_REMINDERS_KEY, PREVIEW_SETTINGS_KEY, PREVIEW_RECIPIENTS_KEY, ISSUE_LOG_KEY].forEach(key => window.localStorage.removeItem(key));
    window.location.reload();
  };
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-shell recovery-shell">
      <section className="self-repair-panel critical" role="alert">
        <div>
          <p className="eyebrow tiny"><AlertTriangle size={13}/> Recovery mode</p>
          <h1>SIR hit a display issue.</h1>
          <p>I saved the issue locally. Try repairing stored reminder data first; if it keeps happening, reset local data and reload.</p>
          <small>{compactIssueMessage(this.state.error?.message || this.state.error)}</small>
        </div>
        <div className="self-repair-actions">
          <button type="button" className="primary" onClick={this.repairAndReload}>Repair and reload</button>
          <button type="button" className="ghost" onClick={this.resetAndReload}>Reset local data</button>
        </div>
      </section>
    </main>;
  }
}


function Field({ label, error, hint, children }) {
  return <label className={`field ${error ? 'invalid' : ''}`}><span>{label}</span>{children}{error ? <em className="field-error"><AlertTriangle size={13}/> {error}</em> : hint ? <em className="field-hint"><CheckCircle2 size={13}/> {hint}</em> : null}</label>;
}

function isFutureDue(form) { return new Date(`${form.date}T${form.time || '00:00'}`).getTime() > Date.now(); }

function deriveSmartInsights(form) {
  const text = `${form.title} ${form.notes}`.toLowerCase();
  const isMeeting = /meeting|review|stakeholder|approval/.test(text);
  const isCall = /call|zoom|teams|meet|online/.test(text);
  const isDeadline = /urgent|deadline|due|final|approval/.test(text);
  const suggestedUrgency = isDeadline ? 'urgent' : form.urgency;
  const suggestedLocation = isCall ? 'Video call / online link' : form.location;
  const intent = isCall ? 'Call reminder' : isMeeting ? 'Meeting reminder' : isDeadline ? 'Deadline reminder' : 'General reminder';
  const confidence = Math.min(96, 62 + [isMeeting, isCall, isDeadline].filter(Boolean).length * 11);
  const suggestions = [];
  if (suggestedUrgency !== form.urgency) suggestions.push('Set urgency to urgent');
  if (suggestedLocation !== form.location) suggestions.push('Use video call / online link');
  if (!suggestions.length) suggestions.push('Reminder looks balanced — ready to package');
  return { intent, confidence, suggestedUrgency, suggestedLocation, suggestions };
}


function compactAddress(raw = '', address = {}) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (/thurston pe center/i.test(text)) return 'Thurston PE Center, 1020 Green St, Honolulu, HI 96822';

  const name = address.name || address.building || address.attraction || address.amenity || '';
  const house = address.house_number || '';
  const road = address.road || address.pedestrian || address.footway || address.path || '';
  const city = address.city || address.town || address.village || address.hamlet || address.county || '';
  const state = address.state || '';
  const postcode = address.postcode || '';
  const street = [house, road].filter(Boolean).join(' ').trim();
  const cityStateZip = [city, [state, postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  if (name && street && cityStateZip) return `${name}, ${street}, ${cityStateZip}`;
  if (street && cityStateZip) return `${street}, ${cityStateZip}`;
  if (name && cityStateZip) return `${name}, ${cityStateZip}`;

  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  const useful = parts.filter(part => !/^(united states|honolulu county|east honolulu|makiki kai|makiki|district|county)$/i.test(part));
  return useful.slice(0, 4).join(', ') || text;
}

async function reverseGeocode(lat, lng) {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`);
    if (!response.ok) throw new Error('Reverse geocoding failed');
    const data = await response.json();
    return compactAddress(data.display_name, { name: data.name, ...(data.address || {}) }) || `Pinned location ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  } catch {
    return `Pinned location ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
  }
}


function hasMappableLocation(reminder) {
  const location = reminder?.location?.trim?.() || '';
  if (reminder?.locationPin?.lat && reminder?.locationPin?.lng) return true;
  if (!location) return false;
  if (/^no location set$/i.test(location)) return false;
  return !/video call|online link|zoom|teams|meet|web call/i.test(location);
}

async function forwardGeocode(address) {
  if (!address || /^no location set$/i.test(address) || /video call|online link|zoom|teams|web call/i.test(address)) return null;
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(address)}`);
    if (!response.ok) throw new Error('Forward geocoding failed');
    const [result] = await response.json();
    if (!result) return null;
    return { lat: Number(result.lat), lng: Number(result.lon), address: compactAddress(result.display_name || address, { name: result.name, ...(result.address || {}) }) || address };
  } catch {
    return null;
  }
}

async function fetchNearbyPois(pin, radiusMeters = 550) {
  if (!pin?.lat || !pin?.lng) return [];
  const lat = Number(pin.lat);
  const lng = Number(pin.lng);
  const query = `
    [out:json][timeout:8];
    (
      node(around:${radiusMeters},${lat},${lng})["amenity"~"restaurant|cafe|bar|pub|fast_food"];
      way(around:${radiusMeters},${lat},${lng})["amenity"~"restaurant|cafe|bar|pub|fast_food"];
      node(around:${radiusMeters},${lat},${lng})["shop"];
      way(around:${radiusMeters},${lat},${lng})["shop"];
    );
    out center tags 30;
  `;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ data: query })
    });
    if (!response.ok) throw new Error('POI lookup failed');
    const data = await response.json();
    return (data.elements || [])
      .map(item => ({
        id: item.id,
        lat: Number(item.lat ?? item.center?.lat),
        lng: Number(item.lon ?? item.center?.lon),
        name: item.tags?.name || item.tags?.brand || item.tags?.operator || 'Nearby place',
        brand: item.tags?.brand || '',
        category: item.tags?.amenity || item.tags?.shop || 'place'
      }))
      .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
      .slice(0, 30);
  } catch {
    return [];
  }
}

async function searchNamedPlaceNear(name, center) {
  if (!name || !center?.lat || !center?.lng) return null;
  const lat = Number(center.lat);
  const lng = Number(center.lng);
  const pad = 0.08;
  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    addressdetails: '1',
    q: name,
    viewbox: `${lng - pad},${lat + pad},${lng + pad},${lat - pad}`,
    bounded: '0'
  });
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
    if (!response.ok) throw new Error('Named place search failed');
    const [result] = await response.json();
    if (!result) return null;
    return {
      lat: Number(result.lat),
      lng: Number(result.lon),
      name: result.name || name,
      category: result.type || 'place',
      address: compactAddress(result.display_name || result.name || name, { name: result.name, ...(result.address || {}) }) || (result.name || name)
    };
  } catch {
    return null;
  }
}


function createDestinationPinIcon(L) {
  return L.divIcon({
    className: 'sir-destination-pin-wrap',
    html: '<span class="sir-destination-pin" aria-hidden="true"><span class="sir-destination-pin-head"></span><span class="sir-destination-pin-stem"></span><span class="sir-destination-pin-shadow"></span></span>',
    iconSize: [36, 44],
    iconAnchor: [18, 41],
    popupAnchor: [0, -38]
  });
}

function bearingBetweenPoints(from, to) {
  if (!from || !to) return 0;
  const fromLat = Number(from.lat) * Math.PI / 180;
  const toLat = Number(to.lat) * Math.PI / 180;
  const deltaLng = (Number(to.lng) - Number(from.lng)) * Math.PI / 180;
  const y = Math.sin(deltaLng) * Math.cos(toLat);
  const x = Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLng);
  const degrees = Math.atan2(y, x) * 180 / Math.PI;
  return Number.isFinite(degrees) ? (degrees + 360) % 360 : 0;
}

function metersBetweenPoints(from, to) {
  if (!from || !to) return Infinity;
  const R = 6371000;
  const lat1 = Number(from.lat) * Math.PI / 180;
  const lat2 = Number(to.lat) * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLng = (Number(to.lng) - Number(from.lng)) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  return Number.isFinite(d) ? d : Infinity;
}

function createCurrentLocationIcon(L, heading = 0) {
  const safeHeading = Number.isFinite(Number(heading)) ? Number(heading) : 0;
  return L.divIcon({
    className: 'sir-current-location-wrap',
    html: `<span class="sir-current-location" aria-hidden="true" style="--heading:${safeHeading}deg"><span class="sir-current-location-arrow"></span><span class="sir-current-location-dot"></span><span class="sir-current-location-pulse"></span></span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
}

const sharedRouteColors = ['#2563eb', '#dc2626', '#16a34a', '#9333ea', '#f97316', '#0891b2', '#be123c', '#4f46e5'];

function getSharedParticipant(token = '') {
  const params = new URLSearchParams(window.location.search);
  const urlRecipient = params.get('recipient') || params.get('r') || '';
  const key = `sir-shared-participant-${token || 'local'}`;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved?.id) return saved;
  } catch {}
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `shared-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const short = id.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase();
  const participant = {
    id,
    name: urlRecipient ? decodeURIComponent(urlRecipient).replace(/\+/g, ' ') : `Shared user ${short}`,
    recipient: urlRecipient || '',
    color: sharedRouteColors[Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % sharedRouteColors.length]
  };
  try { localStorage.setItem(key, JSON.stringify(participant)); } catch {}
  return participant;
}

function mergeSharedLocation(existingLocations = [], nextLocation) {
  const list = Array.isArray(existingLocations) ? existingLocations.filter(Boolean) : [];
  const nextId = nextLocation.id || nextLocation.recipient || nextLocation.name;
  const withoutCurrent = list.filter(item => (item.id || item.recipient || item.name) !== nextId);
  return [...withoutCurrent, nextLocation];
}

function chooseSharedParticipantColor(participant, existingLocations = []) {
  const currentId = participant.id || participant.recipient || participant.name;
  const usedByOthers = new Set((Array.isArray(existingLocations) ? existingLocations : [])
    .filter(item => (item.id || item.recipient || item.name) !== currentId)
    .map(item => item.color)
    .filter(Boolean));
  if (participant.color && !usedByOthers.has(participant.color)) return participant;
  const availableColor = sharedRouteColors.find(color => !usedByOthers.has(color)) || sharedRouteColors[Math.abs([...currentId].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % sharedRouteColors.length];
  const nextParticipant = { ...participant, color: availableColor };
  try { localStorage.setItem(`sir-shared-participant-${new URLSearchParams(window.location.search).get('share') || 'local'}`, JSON.stringify(nextParticipant)); } catch {}
  return nextParticipant;
}


function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function getInitials(name = '') {
  const cleaned = String(name || 'Shared user')
    .replace(/<[^>]*>/g, ' ')
    .replace(/@.*/, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (!parts.length) return 'SU';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function createSharedLocationIcon(L, person, color) {
  const initials = getInitials(person.name);
  const safeName = escapeHtml(person.name || 'Shared user');
  return L.divIcon({
    className: 'sir-shared-location-wrap',
    html: `<span class="sir-shared-location" style="--route-color:${color}" title="${safeName}">${escapeHtml(initials)}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function formatRouteDistance(meters = 0) {
  if (!Number.isFinite(meters) || meters <= 0) return 'route ready';
  const miles = meters / 1609.344;
  return miles < 0.2 ? `${Math.round(meters)} m` : `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

function formatRouteDuration(seconds = 0) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

function formatRouteEtaLabel(person, route) {
  const distance = formatRouteDistance(route.distance);
  const duration = formatRouteDuration(route.duration);
  const name = person?.name || 'Shared user';
  return `${getInitials(name)} · ${distance}${duration ? ` · ${duration}` : ''}`;
}

const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const ROUTE_REQUEST_COOLDOWN_MS = 750;
const routeLookupCache = new Map();
const routePendingLookups = new Map();
const routeLastLookupStartedAt = new Map();

function normalizeRoutePoint(point) {
  return {
    lat: Number(Number(point.lat).toFixed(5)),
    lng: Number(Number(point.lng).toFixed(5))
  };
}

function getRouteLookupKey(origin, destination) {
  const safeOrigin = normalizeRoutePoint(origin);
  const safeDestination = normalizeRoutePoint(destination);
  return `${safeOrigin.lng},${safeOrigin.lat};${safeDestination.lng},${safeDestination.lat}`;
}

function cloneRoute(route, source = 'network') {
  return {
    coordinates: route.coordinates.map(point => [...point]),
    distance: route.distance,
    duration: route.duration,
    source
  };
}

async function fetchShortestRoute(origin, destination) {
  const key = getRouteLookupKey(origin, destination);
  const now = Date.now();
  const cached = routeLookupCache.get(key);
  if (cached && now - cached.at < ROUTE_CACHE_TTL_MS) return cloneRoute(cached.route, 'cache');
  const pending = routePendingLookups.get(key);
  if (pending) return pending.then(route => cloneRoute(route, 'pending'));

  const startLookup = async () => {
    const lastStartedAt = routeLastLookupStartedAt.get(key) || 0;
    const waitMs = Math.max(0, ROUTE_REQUEST_COOLDOWN_MS - (Date.now() - lastStartedAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    routeLastLookupStartedAt.set(key, Date.now());
    const safeOrigin = normalizeRoutePoint(origin);
    const safeDestination = normalizeRoutePoint(destination);
    let parsedRoute;
    try {
      const proxyResponse = await fetch(ROUTE_PROXY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origin: safeOrigin, destination: safeDestination, profile: 'driving' })
      });
      const proxyData = await proxyResponse.json().catch(() => ({}));
      const route = proxyData?.route;
      if (!proxyResponse.ok || proxyData.ok === false || !route?.coordinates?.length) throw new Error(proxyData.error || 'Route proxy failed');
      parsedRoute = {
        coordinates: route.coordinates.map(([lat, lng]) => [Number(lat), Number(lng)]),
        distance: Number(route.distance || 0),
        duration: Number(route.duration || 0),
        proxySource: proxyData.source || 'sirRouteProxy'
      };
    } catch {
      const originLngLat = `${safeOrigin.lng},${safeOrigin.lat}`;
      const destinationLngLat = `${safeDestination.lng},${safeDestination.lat}`;
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${originLngLat};${destinationLngLat}?overview=full&geometries=geojson&steps=false`);
      if (!response.ok) throw new Error('Route lookup failed');
      const data = await response.json();
      const route = data?.routes?.[0];
      if (!route?.geometry?.coordinates?.length) throw new Error('No route found');
      parsedRoute = {
        coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        distance: route.distance,
        duration: route.duration,
        proxySource: 'direct-osrm-fallback'
      };
    }
    routeLookupCache.set(key, { at: Date.now(), route: parsedRoute });
    if (routeLookupCache.size > 80) {
      const oldestKey = [...routeLookupCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]?.[0];
      if (oldestKey) routeLookupCache.delete(oldestKey);
    }
    return parsedRoute;
  };

  const lookup = startLookup().finally(() => routePendingLookups.delete(key));
  routePendingLookups.set(key, lookup);
  return lookup.then(route => cloneRoute(route, 'network'));
}

function PreviewLiveMap({ location, pin, sharedLocations = [], onPinLocation, onLocationShared, hideMapIcons = false, syncBus = null, syncRole = 'in', initialZoom = null }) {
  const mapNode = useRef(null);
  const map = useRef(null);
  const addressMarker = useRef(null);
  const gpsMarker = useRef(null);
  const poiLayer = useRef(null);
  const sharedRouteLayer = useRef(null);
  const sharedMarkerLayer = useRef(null);
  const routeLayer = useRef(null);
  const routeRequest = useRef(0);
  const lastRouteAt = useRef(0);
  const lastRoutePoint = useRef(null);
  const sharedRouteRequest = useRef(0);
  const lastGpsPoint = useRef(null);
  const sharedLocationSentAt = useRef(0);
  const watchId = useRef(null);
  const leaflet = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [status, setStatus] = useState('Address map ready');
  const [routeMeta, setRouteMeta] = useState('');
  const [poiCount, setPoiCount] = useState(0);
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [locationHelpOpen, setLocationHelpOpen] = useState(false);
  const [mapToolsOpen, setMapToolsOpen] = useState(false);
  const [resolvedPin, setResolvedPin] = useState(pin || null);
  const fallback = [21.3069, -157.8583];
  const locationSettingsHelp = 'Location is disabled. Phone: open device Settings > Location and allow this app/browser. PC: open browser Site settings > Location > Allow, then tap Refresh.';

  const lastGeocodeQuery = useRef(null);
  useEffect(() => {
    let cancelled = false;
    if (pin) {
      lastGeocodeQuery.current = null;
      setResolvedPin(pin);
      setStatus('Address pin loaded');
      return;
    }
    const query = String(location || '').trim();
    if (!query || /^no location set$/i.test(query)) {
      lastGeocodeQuery.current = null;
      setResolvedPin(null);
      setStatus('Add an address or pin to place the map marker');
      return;
    }
    if (/video call|online link|zoom|teams|meet|web call/i.test(query)) {
      lastGeocodeQuery.current = null;
      setResolvedPin(null);
      setStatus('Online meeting · no map location needed');
      return;
    }
    // Skip re-geocoding a query we already resolved (avoids flicker on re-render).
    if (lastGeocodeQuery.current === query.toLowerCase()) return;
    // Immediate responsive feedback for both typed and voice-filled input.
    setStatus('Searching address…');
    const runGeocode = () => {
      forwardGeocode(query).then(result => {
        if (cancelled) return;
        lastGeocodeQuery.current = query.toLowerCase();
        if (result) {
          setResolvedPin(result);
          setStatus('Address located on map');
        } else {
          setResolvedPin(null);
          setStatus('No match found · try a fuller address or drop a pin');
        }
      }).catch(() => {
        if (!cancelled) setStatus('Address lookup failed · check the connection or drop a pin');
      });
    };
    // Debounce so fast typing settles on the final text instead of thrashing;
    // voice-filled text arrives in one shot and resolves after the same short delay.
    const timer = setTimeout(runGeocode, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [location, pin]);

  useEffect(() => {
    let cancelled = false;
    if (!mapNode.current || map.current) return;
    setStatus('Loading map…');
    loadLeaflet().then(L => {
      if (cancelled || !mapNode.current || map.current) return;
      leaflet.current = L;
      const center = resolvedPin ? [resolvedPin.lat, resolvedPin.lng] : fallback;
      map.current = L.map(mapNode.current, { zoomControl: false, dragging: true, tap: true, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true, boxZoom: true, keyboard: true, minZoom: 3, maxZoom: 19 }).setView(center, initialZoom != null ? initialZoom : (resolvedPin ? 16 : 11));
      registerSyncMap(syncBus, syncRole, map.current, L);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 19
      }).addTo(map.current);
      // Zoom +/- buttons removed for a cleaner compact map; pinch/scroll still zooms.
      poiLayer.current = L.layerGroup().addTo(map.current);
      sharedRouteLayer.current = L.layerGroup().addTo(map.current);
      sharedMarkerLayer.current = L.layerGroup().addTo(map.current);
      setMapReady(true);
      setStatus(resolvedPin ? 'Address map ready' : 'Add an address or pin to place the map marker');
      setTimeout(() => map.current?.invalidateSize(), 100);
    }).catch(() => setStatus('Map could not load. Check the connection and try again.'));
    return () => {
      cancelled = true;
      unregisterSyncMap(syncBus, syncRole);
      if (watchId.current && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      map.current?.remove();
      map.current = null;
      addressMarker.current = null;
      gpsMarker.current = null;
      lastGpsPoint.current = null;
      routeLayer.current = null;
      sharedRouteRequest.current += 1;
      sharedRouteLayer.current = null;
      sharedMarkerLayer.current = null;
      poiLayer.current = null;
      setRouteMeta('');
      setIsTrackingLocation(false);
      setMapReady(false);
    };
  }, []);

  // Re-register with the sync bus when it becomes available (e.g. edit mode turns on
  // after the map already mounted), so both maps mirror each other.
  useEffect(() => {
    if (!mapReady || !map.current || !leaflet.current) return;
    registerSyncMap(syncBus, syncRole, map.current, leaflet.current);
    return () => unregisterSyncMap(syncBus, syncRole);
  }, [syncBus, syncRole, mapReady]);

  useEffect(() => {
    const L = leaflet.current;
    if (!map.current || !resolvedPin || !L) return;
    const latLng = [resolvedPin.lat, resolvedPin.lng];
    if (!addressMarker.current) {
      addressMarker.current = L.marker(latLng, { icon: createDestinationPinIcon(L), keyboard: false, draggable: Boolean(onPinLocation) }).addTo(map.current);
    } else {
      addressMarker.current.setLatLng(latLng);
      if (onPinLocation) addressMarker.current.dragging?.enable?.();
      else addressMarker.current.dragging?.disable?.();
    }
    addressMarker.current.off('dragend');
    if (onPinLocation) {
      addressMarker.current.on('dragend', event => {
        const next = event.target.getLatLng();
        onPinLocation(next.lat, next.lng);
      });
    }
    addressMarker.current.bindTooltip(onPinLocation ? 'Drag pin to move destination' : 'Pinned destination', { permanent: false });
    map.current.panTo(latLng, { animate: true, duration: 0.25 });
    setTimeout(() => map.current?.invalidateSize(), 100);
  }, [resolvedPin, mapReady, onPinLocation]);

  useEffect(() => {
    const L = leaflet.current;
    if (!map.current || !mapReady || !L || !onPinLocation) return;
    const handleMapClick = event => {
      if (!event?.latlng) return;
      onPinLocation(event.latlng.lat, event.latlng.lng);
    };
    map.current.on('click', handleMapClick);
    return () => map.current?.off('click', handleMapClick);
  }, [mapReady, onPinLocation]);

  useEffect(() => {
    const L = leaflet.current;
    if (!map.current || !resolvedPin || !poiLayer.current || !L) return;
    let cancelled = false;
    poiLayer.current.clearLayers();
    setPoiCount(0);
    fetchNearbyPois(resolvedPin).then(pois => {
      if (cancelled || !poiLayer.current) return;
      poiLayer.current.clearLayers();
      pois.forEach(poi => {
        const marker = L.circleMarker([poi.lat, poi.lng], {
          radius: 5,
          color: '#16a34a',
          weight: 2,
          fillColor: '#22c55e',
          fillOpacity: 0.7
        }).addTo(poiLayer.current);
        marker.bindTooltip(`${poi.name} · ${String(poi.category).replace(/_/g, ' ')}`, { permanent: false });
      });
      setPoiCount(pois.length);
    });
    return () => { cancelled = true; };
  }, [resolvedPin, mapReady]);

  useEffect(() => {
    if (!mapReady || !isTrackingLocation) return;
    if (!resolvedPin) {
      routeRequest.current += 1;
      if (routeLayer.current && map.current) map.current.removeLayer(routeLayer.current);
      routeLayer.current = null;
      setRouteMeta('');
      setStatus('My location enabled · add a pinned destination for routing');
      return;
    }
    if (!lastGpsPoint.current) return;
    drawSmartRoute([lastGpsPoint.current.lat, lastGpsPoint.current.lng]);
  }, [resolvedPin, mapReady, isTrackingLocation]);

  useEffect(() => {
    const L = leaflet.current;
    const people = Array.isArray(sharedLocations) ? sharedLocations.filter(person => Number.isFinite(Number(person.lat)) && Number.isFinite(Number(person.lng))) : [];
    if (!map.current || !sharedRouteLayer.current || !sharedMarkerLayer.current || !L) return;
    const requestId = ++sharedRouteRequest.current;
    let cancelled = false;
    sharedRouteLayer.current.clearLayers();
    sharedMarkerLayer.current.clearLayers();
    if (!resolvedPin || people.length <= 2) return () => { cancelled = true; };
    const destination = { lat: Number(resolvedPin.lat), lng: Number(resolvedPin.lng) };
    const destinationLatLng = [destination.lat, destination.lng];
    const boundsPoints = [destinationLatLng];
    people.forEach((person, index) => {
      const latLng = [Number(person.lat), Number(person.lng)];
      const color = person.color || sharedRouteColors[index % sharedRouteColors.length];
      boundsPoints.push(latLng);
      const marker = L.marker(latLng, { icon: createSharedLocationIcon(L, person, color), keyboard: false }).addTo(sharedMarkerLayer.current);
      marker.bindTooltip(`${getInitials(person.name)} · ${person.name || 'Shared user'}`, { permanent: false });
    });
    if (!routeMeta && !isTrackingLocation) setStatus(`${people.length} shared locations · finding smart routes…`);
    fitOrLock(boundsPoints, { padding: [28, 28], maxZoom: 17, animate: true, duration: 0.2 });

    Promise.all(people.map(async (person, index) => {
      const origin = { lat: Number(person.lat), lng: Number(person.lng) };
      const color = person.color || sharedRouteColors[index % sharedRouteColors.length];
      try {
        const route = await fetchShortestRoute(origin, destination);
        return { person, color, route, fallback: false };
      } catch {
        return { person, color, route: { coordinates: [[origin.lat, origin.lng], destinationLatLng], distance: 0, duration: 0 }, fallback: true };
      }
    })).then(results => {
      if (cancelled || requestId !== sharedRouteRequest.current || !map.current || !sharedRouteLayer.current) return;
      sharedRouteLayer.current.clearLayers();
      const routeBounds = [destinationLatLng];
      let fallbackCount = 0;
      results.forEach(({ person, color, route, fallback }) => {
        if (fallback) fallbackCount += 1;
        route.coordinates.forEach(point => routeBounds.push(point));
        const sharedRouteLine = L.polyline(route.coordinates, {
          color,
          weight: fallback ? 3 : 5,
          opacity: fallback ? 0.48 : 0.86,
          dashArray: fallback ? '6 8' : undefined,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false
        }).addTo(sharedRouteLayer.current);
        sharedRouteLine.bindTooltip(formatRouteEtaLabel(person, route), { permanent: true, direction: 'center', className: 'sir-route-label' });
      });
      if (!routeMeta && !isTrackingLocation) {
        setStatus(fallbackCount ? `${people.length - fallbackCount} smart routes · ${fallbackCount} direct fallback${fallbackCount > 1 ? 's' : ''}` : `${people.length} shared locations · smart routes`);
      }
      fitOrLock(routeBounds, { padding: [28, 28], maxZoom: 17, animate: true, duration: 0.22 });
    });
    return () => { cancelled = true; };
  }, [sharedLocations, resolvedPin, mapReady, routeMeta, isTrackingLocation]);

  useEffect(() => {
    const refreshMapLayout = () => {
      const liveMap = map.current;
      if (!liveMap) return;
      liveMap.invalidateSize({ pan: false });
      const center = liveMap.getCenter();
      liveMap.setView(center, liveMap.getZoom(), { animate: false });
    };

    // Leaflet measures its container before/while the CSS expanded layout settles.
    // Multiple invalidations prevent the "map tiles only at the top, blank below" bug.
    const delays = mapExpanded ? [0, 80, 180, 320, 600] : [0, 80, 180];
    const timers = delays.map(delay => setTimeout(refreshMapLayout, delay));
    document.body.classList.toggle('sir-map-expanded', mapExpanded);
    return () => {
      timers.forEach(clearTimeout);
      document.body.classList.remove('sir-map-expanded');
    };
  }, [mapExpanded]);

  function fitOrLock(latLngsOrBounds, options = { padding: [28, 28], maxZoom: 17, animate: true, duration: 0.2 }) {
    const L = leaflet.current;
    if (!L || !map.current) return;
    const bounds = latLngsOrBounds instanceof L.LatLngBounds ? latLngsOrBounds : L.latLngBounds(latLngsOrBounds);
    // Auto-adjust the view to fit the route/points. Sync will mirror to the paired map.
    map.current.fitBounds(bounds, options);
  }

  async function drawSmartRoute(userLatLng) {
    const L = leaflet.current;
    if (!L || !map.current || !resolvedPin) {
      setStatus('My location enabled · add a pinned destination for routing');
      return;
    }
    const requestId = ++routeRequest.current;
    const origin = { lat: userLatLng[0], lng: userLatLng[1] };
    const destination = { lat: Number(resolvedPin.lat), lng: Number(resolvedPin.lng) };
    const directCoordinates = [userLatLng, [destination.lat, destination.lng]];

    if (routeLayer.current) map.current.removeLayer(routeLayer.current);
    routeLayer.current = L.polyline(directCoordinates, {
      color: '#2563eb',
      weight: 5,
      opacity: 0.62,
      dashArray: '8 8',
      lineCap: 'round',
      interactive: false
    }).addTo(map.current);
    fitOrLock(directCoordinates, { padding: [28, 28], maxZoom: 17, animate: true, duration: 0.18 });
    setRouteMeta('Route ready · optimizing smart route…');
    setStatus('My location enabled · route ready');

    try {
      const route = await fetchShortestRoute(origin, destination);
      if (requestId !== routeRequest.current || !map.current) return;
      if (routeLayer.current) map.current.removeLayer(routeLayer.current);
      routeLayer.current = L.polyline(route.coordinates, {
        color: '#2563eb',
        weight: 6,
        opacity: 0.82,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(map.current);
      const bounds = L.latLngBounds([...route.coordinates, userLatLng, [destination.lat, destination.lng]]);
      fitOrLock(bounds, { padding: [28, 28], maxZoom: 17, animate: true, duration: 0.22 });
      const distanceLabel = formatRouteDistance(route.distance);
      const durationLabel = formatRouteDuration(route.duration);
      const summary = `Smart route · ${distanceLabel}${durationLabel ? ` · ${durationLabel}` : ''}`;
      setRouteMeta(summary);
      setStatus(`My location enabled · ${distanceLabel}${durationLabel ? ` · ${durationLabel}` : ''}`);
    } catch {
      if (requestId !== routeRequest.current || !map.current) return;
      setRouteMeta('Smart route unavailable · showing direct path');
      setStatus('My location enabled · direct path shown');
    }
  }

  const gpsOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 };

  function applyGpsPosition(position) {
    const latLng = [position.coords.latitude, position.coords.longitude];
    const currentPoint = { lat: latLng[0], lng: latLng[1] };
    const nativeHeading = Number(position.coords.heading);
    const heading = Number.isFinite(nativeHeading) ? nativeHeading : bearingBetweenPoints(lastGpsPoint.current, currentPoint);
    const L = leaflet.current;
    if (!L || !map.current) return;
    const headingIcon = createCurrentLocationIcon(L, heading);
    if (!gpsMarker.current) {
      gpsMarker.current = L.marker(latLng, { icon: headingIcon, keyboard: false }).addTo(map.current);
    } else {
      gpsMarker.current.setLatLng(latLng);
      gpsMarker.current.setIcon(headingIcon);
    }
    lastGpsPoint.current = currentPoint;
    const now = Date.now();
    if (onLocationShared && now - sharedLocationSentAt.current > 8000) {
      sharedLocationSentAt.current = now;
      onLocationShared({ ...currentPoint, accuracy: position.coords.accuracy || 0, heading });
    }
    gpsMarker.current.bindTooltip(`My location · heading ${Math.round(heading)}°`, { permanent: false });
    setStatus(`My location refreshed · heading ${Math.round(heading)}° · ±${Math.round(position.coords.accuracy || 0)}m`);
    // Stabilize the route: only recompute when the user has moved a meaningful
    // distance (>25m) or enough time has passed (>12s). Prevents path jitter on
    // every GPS tick while the marker itself still follows smoothly.
    const now2 = Date.now();
    const movedFar = metersBetweenPoints(lastRoutePoint.current, currentPoint) > 25;
    const staleEnough = now2 - lastRouteAt.current > 12000;
    if (!lastRoutePoint.current || movedFar || staleEnough) {
      lastRoutePoint.current = currentPoint;
      lastRouteAt.current = now2;
      drawSmartRoute(latLng);
    }
  }

  function handleGpsUnavailable(error) {
    watchId.current = null;
    setIsTrackingLocation(false);
    setStatus(locationSettingsHelp);
    // Permission denied / position unavailable -> guide the user to Settings.
    if (!error || error.code === 1 || error.code === 2) setLocationHelpOpen(true);
  }

  function startGpsWatch() {
    if (!navigator.geolocation) return;
    watchId.current = navigator.geolocation.watchPosition(applyGpsPosition, handleGpsUnavailable, gpsOptions);
  }

  function stopGpsTracking() {
    navigator.geolocation?.clearWatch?.(watchId.current);
    watchId.current = null;
    routeRequest.current += 1;
    if (gpsMarker.current && map.current) map.current.removeLayer(gpsMarker.current);
    if (routeLayer.current && map.current) map.current.removeLayer(routeLayer.current);
    gpsMarker.current = null;
    routeLayer.current = null;
    lastGpsPoint.current = null;
    lastRoutePoint.current = null;
    lastRouteAt.current = 0;
    setRouteMeta('');
    setIsTrackingLocation(false);
    setStatus('Location sharing stopped. Tap Share my location or Refresh to reconnect.');
  }

  function refreshLiveRoute() {
    if (!navigator.geolocation) {
      setStatus(locationSettingsHelp);
      return;
    }
    if (!mapReady) {
      setStatus('Map is still loading. Try again in a moment.');
      return;
    }
    setStatus('Refreshing live route…');
    setIsTrackingLocation(true);
    if (watchId.current) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    navigator.geolocation.getCurrentPosition(position => {
      applyGpsPosition(position);
      startGpsWatch();
    }, error => {
      if (lastGpsPoint.current) {
        drawSmartRoute([lastGpsPoint.current.lat, lastGpsPoint.current.lng]);
        setStatus('Route refreshed from the last known location');
        startGpsWatch();
        return;
      }
      handleGpsUnavailable(error);
    }, gpsOptions);
  }

  function trackGps() {
    // Toggle: first tap turns location sharing ON, a second tap turns it OFF.
    // Use the visible tracking state (flips immediately) plus watchId so a
    // quick second tap during the permission prompt still deactivates cleanly.
    if (isTrackingLocation || watchId.current) {
      stopGpsTracking();
      return;
    }
    if (!navigator.geolocation) {
      setStatus(locationSettingsHelp);
      return;
    }
    if (!mapReady) {
      setStatus('Map is still loading. Try again in a moment.');
      return;
    }
    setStatus('Enabling my location…');
    // Proactively check permission state so we can prompt for Settings if it's off.
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: 'geolocation' }).then(result => {
        if (result.state === 'denied') {
          setIsTrackingLocation(false);
          setStatus(locationSettingsHelp);
          setLocationHelpOpen(true);
          return;
        }
        setIsTrackingLocation(true);
        startGpsWatch();
      }).catch(() => { setIsTrackingLocation(true); startGpsWatch(); });
      return;
    }
    setIsTrackingLocation(true);
    startGpsWatch();
  }

  // Once location sharing is enabled, drop the "No location set" hint and show
  // the live status/route instead (label auto-hides if there is nothing to say).
  const overlayLabel = isTrackingLocation
    ? (routeMeta || status || 'Sharing your live location…')
    : (isLocationUnset(location) ? 'No location set' : (onPinLocation && resolvedPin ? 'Drag the pin or tap the map to move it' : (routeMeta || status)));
  const showOverlayLabel = !!(overlayLabel && overlayLabel.trim());
  return <div className={`preview-live-map ${mapExpanded ? 'expanded' : ''} ${hideMapIcons ? 'hide-map-icons' : ''}`} aria-label="Live reminder map">
    {locationHelpOpen && <div className="settings-modal-backdrop location-help-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setLocationHelpOpen(false); }}>
      <section className="settings-modal location-help-modal" role="dialog" aria-modal="true" aria-label="Turn on location services">
        <button type="button" className="settings-modal-close" onClick={() => setLocationHelpOpen(false)} aria-label="Close">×</button>
        <div className="location-help-icon"><MapPin size={26}/></div>
        <h2>Turn on location services</h2>
        <p>Location access is currently turned off, so we can’t share your live location.</p>
        <ul>
          <li><strong>iPhone:</strong> Settings → Privacy &amp; Security → Location Services → turn on, then allow SIR.</li>
          <li><strong>Android:</strong> Settings → Location → turn on, then allow SIR.</li>
          <li><strong>Browser:</strong> Site settings → Location → Allow, then reload.</li>
        </ul>
        <button type="button" className="primary location-help-done" onClick={() => setLocationHelpOpen(false)}>Got it</button>
      </section>
    </div>}
    <div className={`preview-map-shell ${mapToolsOpen ? 'tools-open' : ''}`}>
      <div className="preview-map-canvas" ref={mapNode} />
      {showOverlayLabel && <div className={`preview-map-label-overlay ${mapToolsOpen ? 'shifted' : ''}`} aria-live="polite"><MapPin size={13}/> <span>{overlayLabel}{poiCount > 0 && !routeMeta ? ` · ${poiCount} nearby places` : ''}</span></div>}
      {/* Centered Location Tools toggle — expands the tools directly on the map */}
      <button type="button" className={`preview-map-tools-toggle ${mapToolsOpen ? 'active' : ''}`} onClick={() => setMapToolsOpen(open => !open)} aria-pressed={mapToolsOpen} aria-label={mapToolsOpen ? 'Hide location tools' : 'Location tools'} title={mapToolsOpen ? 'Hide location tools' : 'Location tools'}>
        <Settings2 size={16}/>
      </button>
      {mapToolsOpen && <div className="preview-map-tools-bar" role="group" aria-label="Location tools">
        <button type="button" className={`share-location-button ${isTrackingLocation ? 'active' : 'inactive'}`} aria-pressed={isTrackingLocation} onClick={trackGps}><MapPin size={14} fill={isTrackingLocation ? 'currentColor' : 'none'}/> {isTrackingLocation ? 'Stop sharing location' : 'Share my location'}</button>
        <button type="button" className="preview-map-tool-btn" onClick={refreshLiveRoute}><RefreshCw size={14}/> Recenter</button>
      </div>}
      <button type="button" className="preview-map-expand" onClick={() => setMapExpanded(value => !value)} aria-label={mapExpanded ? 'Minimize map' : 'Expand map'} title={mapExpanded ? 'Minimize map' : 'Expand map'}>
        {mapExpanded ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}
      </button>
      {!mapToolsOpen && <div className="preview-map-share-overlay">
        {mapExpanded && <button type="button" className="preview-map-refresh" onClick={refreshLiveRoute}><RefreshCw size={13}/> Refresh</button>}
        <button type="button" className={`share-location-button ${isTrackingLocation ? 'active' : 'inactive'}`} aria-pressed={isTrackingLocation} onClick={trackGps}><MapPin size={14} fill={isTrackingLocation ? 'currentColor' : 'none'}/> {isTrackingLocation ? 'Stop sharing location' : 'Share my location'}</button>
      </div>}
    </div>
  </div>;
}

function LocationMap({ pin, onSelect, syncBus = null, syncRole = 'out', initialZoom = 13 }) {
  const mapNode = useRef(null);
  const map = useRef(null);
  const marker = useRef(null);
  const leaflet = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  const fallback = [21.3069, -157.8583];

  useEffect(() => { onSelectRef.current = onSelect; }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    if (!mapNode.current || map.current) return;
    loadLeaflet().then(L => {
      if (cancelled || !mapNode.current || map.current) return;
      leaflet.current = L;
      const center = pin ? [pin.lat, pin.lng] : fallback;
      map.current = L.map(mapNode.current, { zoomControl: false, attributionControl: false, dragging: true, tap: true, touchZoom: true, scrollWheelZoom: true, doubleClickZoom: true, boxZoom: true, keyboard: true, minZoom: 3, maxZoom: 19 }).setView(center, initialZoom);
      registerSyncMap(syncBus, syncRole, map.current, L);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 19
      }).addTo(map.current);
      map.current.on('click', event => onSelectRef.current?.(event.latlng.lat, event.latlng.lng));
      setMapReady(true);
      setTimeout(() => map.current?.invalidateSize(), 80);
    });
    return () => {
      cancelled = true;
      unregisterSyncMap(syncBus, syncRole);
      map.current?.remove();
      map.current = null;
      marker.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady || !map.current || !leaflet.current) return;
    registerSyncMap(syncBus, syncRole, map.current, leaflet.current);
    return () => unregisterSyncMap(syncBus, syncRole);
  }, [syncBus, syncRole, mapReady]);

  useEffect(() => {
    const L = leaflet.current;
    if (!map.current || !pin || !L) return;
    const latLng = [pin.lat, pin.lng];
    if (!marker.current) {
      marker.current = L.circleMarker(latLng, { radius: 9, color: '#f97316', weight: 3, fillColor: '#f97316', fillOpacity: 0.35 }).addTo(map.current);
    } else {
      marker.current.setLatLng(latLng);
    }
    map.current.panTo(latLng, { animate: true, duration: 0.25 });
    setTimeout(() => map.current?.invalidateSize(), 80);
  }, [pin, mapReady]);

  return <div className="leaflet-map" ref={mapNode} aria-label="Interactive location picker">{!mapReady && <span className="map-loading">Loading map…</span>}</div>;
}

function InteractiveLine({ label, value, onRemove }) {
  const [state, setState] = useState('idle');
  const start = useRef(null);
  const timer = useRef(null);

  function onPointerDown(event) {
    start.current = { x: event.clientX, armed: false };
    timer.current = setTimeout(() => {
      start.current = { ...start.current, armed: true };
      setState('armed');
    }, 350);
  }
  function onPointerMove(event) {
    if (!start.current?.armed) return;
    const dx = event.clientX - start.current.x;
    if (dx < -55) setState('saved');
    if (dx > 55) setState('removed');
  }
  function onPointerUp() {
    clearTimeout(timer.current);
    if (state === 'removed') onRemove?.();
    setTimeout(() => setState('idle'), 800);
    start.current = null;
  }

  return <div className={`line-item ${state}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
    <span className="line-label">{label}</span>
    <strong>{value}</strong>
    <small>{state === 'armed' ? 'selected' : state === 'saved' ? 'saved' : state === 'removed' ? 'removed' : 'detail'}</small>
  </div>;
}

function ReminderCard({ reminder, onEdit, onForward, onDelete, recipientMode = false, compactMode = false, forceMap = false, onCompactVoice, compactVoiceListening = false, compactVoiceTranscript = '', onPinLocation, onLocationShared, sharedSummary = '', sharedMeta = null, cardIndex = 0, cardTotal = 1, onPrevCard, onNextCard, previewRecipients = [], showRecipients = false, onToggleRecipients, previewTimezone = 'HST', onPreviewTimezoneChange, editMode = false, editDate = '', editTime = '', onEditDate, onEditTime, editLocation = '', onEditLocation, locationToolsOpen = false, onToggleLocationTools, onUseMyLocation, onClearLocation, locationStatus = '', editText = '', onEditText }) {
  const [expanded, setExpanded] = useState(true);
  const [ring, setRing] = useState(false);
  const [previewPinPickerOpen, setPreviewPinPickerOpen] = useState(false);
  // Shared bus so the Zoom-Out and Zoom-In maps stay synchronized while both remain interactive.
  const mapSync = useRef({ maps: {}, applying: false, ZOOM_OFFSET: 4 });
  const drawing = useRef([]);
  const status = getStatus(reminder);
  const urgencyKey = reminder.urgency || 'low';
  const urgencyMeta = urgencyLevels[urgencyKey] || urgencyLevels.low;
  const urgencyPreviewLabel = urgencyKey === 'urgent' ? 'Important' : '';
  const scheduleBorder = urgencyMeta?.color || '#3b82f6';
  const accent = '#22c55e';
  const noLocationSet = isLocationUnset(reminder.location);
  const locationLabel = noLocationSet ? 'No location set' : compactAddress(reminder.location);
  const dueLabel = noLocationSet && !recipientMode ? formatDueForPreviewTimezone(reminder, previewTimezone) : formatDue(reminder);
  const canEditMapPin = Boolean(onPinLocation && (!recipientMode || editMode));

  function drawStart(e) {
    if (!e.shiftKey && e.pointerType === 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    drawing.current = [{ x: e.clientX - rect.left, y: e.clientY - rect.top }];
  }
  function drawMove(e) {
    if (!drawing.current.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    drawing.current.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }
  function drawEnd() {
    if (isCircleGesture(drawing.current)) {
      setRing(true);
      setTimeout(() => onForward(), 450);
      setTimeout(() => setRing(false), 1800);
    }
    drawing.current = [];
  }

  return <article className={`reminder-card simplified-preview ${editMode && locationToolsOpen ? 'loctools-active' : ''}`} style={{ '--accent': accent, '--schedule-border': scheduleBorder }}>

    <div className="preview-card-toolbar">
      {!recipientMode && onDelete && <button type="button" className="ghost preview-delete-card" aria-label="Delete preview reminder" title="Delete preview reminder" onClick={onDelete}><X size={17}/></button>}
      <button className={`ghost top-action icon-only ${expanded ? 'expanded' : 'collapsed'}`} aria-label={expanded ? 'Minimize preview' : 'Expand preview'} title={expanded ? 'Minimize preview' : 'Expand preview'} onClick={() => setExpanded(!expanded)}><ChevronDown size={18}/></button>
    </div>
    {compactMode && onCompactVoice && <button type="button" className={`mic-button preview-card-centered-mic ${compactVoiceListening ? 'listening' : ''}`} style={compactVoiceListening ? { '--mic-bg': '#dcfce7', '--mic-fg': '#16a34a' } : undefined} onClick={onCompactVoice} aria-label="Speak to fill reminder"><Mic size={18}/></button>}
    {ring && <div className="magic-ring"><Sparkles size={22}/><span>Ready to send</span></div>}
    {!recipientMode && !compactMode && <div className="preview-heading-row"><h2 className="preview-heading">Preview reminder</h2></div>}
    {compactMode ? <div className={`preview-title compact-title-voice-holder voice-capture-box ${compactVoiceListening ? 'listening' : ''} ${(compactVoiceTranscript || (editMode && editText)) ? 'has-transcript' : ''} ${editMode ? 'editing' : ''}`} role="status" aria-live="polite">
      <span className="voice-star-wrap"><Sparkles size={15}/></span>
      {editMode ? <textarea className="voice-box-input" value={editText} onChange={event => onEditText?.(event.target.value)} rows={2} aria-label="Edit reminder text" autoFocus /> : <span className="voice-box-text">{compactVoiceListening ? (compactVoiceTranscript || 'Listening…') : (compactVoiceTranscript || (editText && editText.trim() && editText.trim() !== 'Meeting at the bar' ? editText : 'Speak to automatically display the date, time, and location.'))}</span>}
    </div> : editMode && recipientMode ? <textarea className="recipient-title-inline" value={editText} onChange={event => onEditText?.(event.target.value)} rows={2} aria-label="Edit reminder text" autoFocus /> : <h3 className="preview-title">{reminder.title}</h3>}
    <div className={`due ${status.tone}`}><span className="due-left"><CalendarClock size={17}/> <span>{dueLabel}</span></span>{urgencyPreviewLabel && <span className="preview-importance">{urgencyPreviewLabel}</span>}</div>
    {editMode && <div className="preview-edit-schedule">
      <label><span>Date</span><input type="date" value={editDate} onChange={event => onEditDate?.(event.target.value)} aria-label="Edit reminder date" /></label>
      <label><span>Time</span><input type="time" value={editTime} onChange={event => onEditTime?.(event.target.value)} aria-label="Edit reminder time" /></label>
    </div>}
    {editMode && recipientMode && <div className="recipient-inline-location-edit">
      <label><span>Location</span><input value={editLocation} onChange={event => onEditLocation?.(event.target.value)} aria-label="Edit reminder location" placeholder="Search address, venue, landmark, or paste link" /></label>
    </div>}
    <div className="inline-actions inline-actions-under-calendar">{!(recipientMode && editMode) && <button type="button" className={editMode ? 'preview-edit-done blinking' : ''} onClick={onEdit}>{editMode ? 'Done editing' : 'Edit schedule & location'}</button>}{editMode && onToggleLocationTools && <button type="button" className="preview-location-tools-trigger" onClick={onToggleLocationTools}><MapPin size={15}/> Location tools</button>}</div>
    {editMode && locationToolsOpen && <div className="preview-loctools-inline" aria-label="Location tools options">
      {canEditMapPin && <button type="button" className="preview-loctools-option" onClick={() => { setExpanded(true); setPreviewPinPickerOpen(true); }}><MapPin size={16}/> Drop pin on map</button>}
      {onUseMyLocation && <button type="button" className="preview-loctools-option" onClick={() => { onUseMyLocation(); }}><LocateFixed size={16}/> Use my location</button>}
      {recipientMode && onClearLocation && <button type="button" className="preview-loctools-option" onClick={() => { onClearLocation(); }}><X size={16}/> Clear location</button>}
      {locationStatus && <p className="preview-loctools-status">{locationStatus}</p>}
    </div>}
    {recipientMode && sharedSummary && <div className="shared-change-summary"><CheckCircle2 size={15}/><span>{sharedSummary}{sharedMeta && <em>Changed by {formatEditorName(sharedMeta.editor)} · {formatChangeTimestamp(sharedMeta.at)}</em>}</span></div>}
    {expanded && <div className="preview-summary">
      <div className="preview-location-timezone-row"><p>{compactMode && onPinLocation ? <button type="button" className={`preview-location-pin-icon ${previewPinPickerOpen ? 'active' : ''}`} aria-label="Zoom-In and Zoom-Out Views" title="Zoom-In and Zoom-Out Views" onClick={() => setPreviewPinPickerOpen(open => !open)}><MapPin size={15}/><span className="preview-location-pin-label">Zoom-In and Zoom-Out Views</span></button> : <MapPin size={15}/>} <span className={compactMode ? 'preview-location-text-compact' : ''}>{locationLabel}</span>{!compactMode && canEditMapPin && <button type="button" className="preview-pin-location-button" aria-label="Manually pin correct location" title="Manually pin correct location" onClick={() => setPreviewPinPickerOpen(open => !open)}><MapPin size={14}/> Pin</button>}</p></div>
      {compactMode && previewPinPickerOpen && canEditMapPin && <section className="map-card preview-pin-picker" aria-label="Manual preview location pin"><p className="map-view-label">Zoom-Out View</p><LocationMap pin={reminder.locationPin} onSelect={(lat, lng) => onPinLocation?.(lat, lng)} syncBus={mapSync.current} syncRole="out" initialZoom={13} /><p className="map-help"><MapPin size={14}/> Tap the map to drop the correct pin for this reminder.</p></section>}
      {(forceMap || hasMappableLocation(reminder)) && <div className={`preview-live-map-wrap ${(editMode || (compactMode && previewPinPickerOpen)) ? 'zoom-in-view' : ''}`}>{(editMode || (compactMode && previewPinPickerOpen)) && <p className="map-view-label">Zoom-In View</p>}<PreviewLiveMap location={reminder.location} pin={reminder.locationPin} sharedLocations={reminder.sharedLocations} onPinLocation={canEditMapPin ? onPinLocation : undefined} onLocationShared={onLocationShared} hideMapIcons={editMode && !recipientMode} syncBus={(editMode || (compactMode && previewPinPickerOpen)) ? mapSync.current : null} syncRole="in" initialZoom={(editMode || (compactMode && previewPinPickerOpen)) ? 17 : null} /></div>}
      {reminder.notes && <p className="preview-instruction">{reminder.notes.length > 80 ? `${reminder.notes.slice(0, 80)}…` : reminder.notes}</p>}
      {previewRecipients.length > 0 && showRecipients && <div className="preview-recipients">
        <div><strong>Recipients</strong><span>{previewRecipients.join(', ')}</span></div>
        {onToggleRecipients && <button type="button" className="ghost recipient-visibility" onClick={onToggleRecipients}>Hide</button>}
      </div>}
    </div>}
    {compactMode && !recipientMode ? <div className="compact-preview-send-row"><button type="button" className="primary compact-preview-send-cta composer-recipient-cta" onClick={onForward}><Send size={16}/> Send to whom?</button></div> : <p className="hint preview-recipient-note">{recipientMode ? <><span>Interactive shared reminder.</span><span>Edit the schedule, location, or location tracking on this device.</span></> : <><span>Recipients can adjust the schedule and location.</span><span>They can enable tracking from the live map.</span></>}</p>}
  </article>;
}




const SPOKEN_DIGITS = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', too: '2', to: '2', three: '3', four: '4', for: '4', five: '5', six: '6', seven: '7', eight: '8', ate: '8', nine: '9'
};

function normalizeSpokenRecipientText(text = '') {
  let normalized = String(text || '').trim();
  if (!normalized) return '';
  normalized = normalized
    .replace(/\b(?:add|enter|include|put|set)\s+(?:a\s+)?(?:recipient|contact)\b[:,]?\s*/gi, ' ')
    .replace(/\b(?:recipient|contact)\s+(?:is|as)\b[:,]?\s*/gi, ' ')
    .replace(/\b(at sign|at symbol)\b/gi, ' @ ')
    .replace(/\b(at)\b/gi, ' @ ')
    .replace(/\b(dot|period)\b/gi, ' . ')
    .replace(/\b(underscore)\b/gi, ' _ ')
    .replace(/\b(dash|hyphen)\b/gi, ' - ')
    .replace(/\bplus\b/gi, ' + ')
    .replace(/\b(gmail|hotmail|outlook|yahoo|icloud|aol)\s+(com|net|org|edu)\b/gi, '$1.$2')
    .replace(/\b([a-z0-9._%+-]+)\s*@\s*([a-z0-9.-]+)\s*\.\s*([a-z]{2,})\b/gi, '$1@$2.$3')
    .replace(/\s*([@._+-])\s*/g, '$1')
    .replace(/\b(?:zero|oh|o|one|two|too|to|three|four|for|five|six|seven|eight|ate|nine)\b/gi, word => SPOKEN_DIGITS[word.toLowerCase()] || word)
    .replace(/(\d)[.。](?=$|[\s,;])/g, '$1')
    .replace(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})[.。](?=$|[\s,;])/gi, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  if (/@|\d/.test(normalized)) normalized = normalized.replace(/\s+and\s+/gi, ', ');
  return normalized;
}

function rowsFromVoiceRecipientText(text = '') {
  const normalized = normalizeSpokenRecipientText(text);
  const rows = rowsFromRecipientText(normalized);
  return rows
    .filter(row => !/^\s*(?:add|enter|include|put|set)?\s*(?:a\s+)?(?:recipient|contact)?\s*$/i.test(row))
    .map(row => smartFormatRecipients(row));
}


function isContactSearchRequest(text = '') {
  return /\b(contact|contacts|phone number|email address|email|number|send to|recipient)\b/i.test(String(text || ''));
}

function rowsFromDeviceContacts(deviceContacts = []) {
  return deviceContacts.flatMap(contact => {
    const rawName = Array.isArray(contact?.name) ? contact.name[0] : contact?.name;
    const name = cleanRecipientName(rawName || '');
    const entries = [...(contact?.tel || []), ...(contact?.email || [])].filter(Boolean);
    return entries.map(value => formatRecipientInput({ name: isSafeRecipientName(name) ? name : '', value, type: isEmail(value) ? 'email' : 'phone' }));
  }).filter(Boolean);
}

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextWeekday(dayName, baseDate = new Date()) {
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = days.indexOf(String(dayName).toLowerCase());
  if (target < 0) return null;
  const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  let diff = (target - base.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(base, diff);
}

function toDateValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveMonthDate(monthIndex, day, year, baseDate = new Date()) {
  const candidateYear = year || baseDate.getFullYear();
  let date = new Date(candidateYear, monthIndex, day);
  if (!year) {
    const base = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    if (date < base) date = new Date(candidateYear + 1, monthIndex, day);
  }
  return date;
}

function parseMonthNameDate(lower, baseDate = new Date()) {
  const months = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
    july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
  };
  const monthWords = Object.keys(months).join('|');
  const monthFirst = lower.match(new RegExp(`\\b(${monthWords})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'));
  if (monthFirst) {
    const date = resolveMonthDate(months[monthFirst[1].toLowerCase()], Number(monthFirst[2]), monthFirst[3] ? Number(monthFirst[3]) : null, baseDate);
    if (!Number.isNaN(date.getTime())) return toDateValue(date);
  }
  const dayFirst = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+of\\s+(${monthWords})(?:,?\\s+(\\d{4}))?\\b`, 'i'));
  if (dayFirst) {
    const date = resolveMonthDate(months[dayFirst[2].toLowerCase()], Number(dayFirst[1]), dayFirst[3] ? Number(dayFirst[3]) : null, baseDate);
    if (!Number.isNaN(date.getTime())) return toDateValue(date);
  }
  return '';
}

function stripSpokenDatePhrases(text) {
  return text
    .replace(/\b(?:today|tomorrow|next\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|this\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|coming\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|on\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/gi, ' ')
    .replace(/\b(?:on\s+)?(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, ' ')
    .replace(/\b(?:on\s+)?\d{1,2}(?:st|nd|rd|th)?\s+of\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+\d{4})?\b/gi, ' ');
}

function parseVoiceDate(text, baseDate = new Date()) {
  const lower = text.toLowerCase();
  if (/\btomorrow\b/.test(lower)) return toDateValue(addDays(baseDate, 1));
  if (/\btoday\b/.test(lower)) return toDateValue(baseDate);
  const monthDate = parseMonthNameDate(lower, baseDate);
  if (monthDate) return monthDate;
  const weekday = lower.match(/\b(?:next|this|coming|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/) || lower.match(/(?:^|[\s,.;])(?:for\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=$|[\s,.;])/);
  if (weekday) return toDateValue(nextWeekday(weekday[1], baseDate));
  const slash = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slash) {
    const year = slash[3] ? Number(String(slash[3]).padStart(4, '20')) : baseDate.getFullYear();
    const date = new Date(year, Number(slash[1]) - 1, Number(slash[2]));
    if (!Number.isNaN(date.getTime())) return toDateValue(date);
  }
  return '';
}

function parseVoiceTime(text) {
  // Speech engines return meridiem in many forms: "am", "a.m.", "a. m.", "AM", "pm", "p.m.".
  // Accept optional dots/spaces between and after the letters, and allow "o'clock".
  let match = text.match(/\b(?:at|around)?\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i);
  if (match) {
    let hour = Number(match[1]);
    const minute = match[2] || '00';
    const meridiem = match[3].toLowerCase();
    if (meridiem === 'p' && hour < 12) hour += 12;
    if (meridiem === 'a' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  // "8 o'clock" / "8 oclock" (assume the spoken hour as-is, 24h if >12).
  match = text.match(/\b(?:at|around)?\s*(\d{1,2})(?::(\d{2}))?\s*o['\u2019]?\s*clock\b/i);
  if (match) {
    const hour = Number(match[1]);
    const minute = match[2] || '00';
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }
  // Bare "at 8:30" with no meridiem — take it literally.
  match = text.match(/\bat\s+(\d{1,2}):(\d{2})\b/i);
  if (match) {
    return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
  }
  return '';
}

const US_STATE_NAMES = ['alabama','alaska','arizona','arkansas','california','colorado','connecticut','delaware','florida','georgia','hawaii','idaho','illinois','indiana','iowa','kansas','kentucky','louisiana','maine','maryland','massachusetts','michigan','minnesota','mississippi','missouri','montana','nebraska','nevada','new hampshire','new jersey','new mexico','new york','north carolina','north dakota','ohio','oklahoma','oregon','pennsylvania','rhode island','south carolina','south dakota','tennessee','texas','utah','vermont','virginia','washington','west virginia','wisconsin','wyoming','district of columbia'];

function parseVoiceLocation(text) {
  // 1. Preposition-based: "at/near/in <place>"
  const matches = [...String(text || '').matchAll(/\b(?:at|near|in)\s+(?!\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b)([^,.]+?)(?=\s+(?:with|for|on|tomorrow|today|next\s+\w+|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm))|[,.]|$)/gi)]
    .map(match => match[1]?.trim())
    .filter(Boolean)
    .filter(value => !/^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i.test(value));
  if (matches.length) return matches.at(-1);

  // 2. No-preposition fallback so plain place phrases like "California, USA" resolve.
  const cleaned = stripSpokenDatePhrases(String(text || ''))
    .replace(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/gi, ' ')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, ' ')
    .replace(/\b(remind me to|remind me|create a reminder to|create a reminder|schedule|meeting|meet|appointment|call|lunch|dinner|coffee)\b/gi, ' ')
    .replace(/\b(?:at|around)?\s*\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 2a. "<Place>, <Region/USA>" (e.g. "California, USA." or "Austin, Texas")
  const commaPlace = cleaned.match(/([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3})\s*,\s*(USA|U\.S\.A\.?|United States|[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2})\.?$/);
  if (commaPlace) {
    const place = commaPlace[1].trim();
    const region = commaPlace[2].replace(/\.$/, '').trim();
    if (place.length >= 2) return `${place}, ${region}`.replace(/\s+/g, ' ').trim();
  }

  // 2b. A recognized US state name anywhere in the phrase.
  const lower = cleaned.toLowerCase();
  const stateHit = US_STATE_NAMES.find(state => new RegExp(`(^|[^a-z])${state}([^a-z]|$)`, 'i').test(lower));
  if (stateHit) {
    return stateHit.replace(/\b\w/g, c => c.toUpperCase());
  }

  return '';
}


function parseNearestPlaceRequest(text) {
  const lower = text.toLowerCase();
  if (!/\b(nearest|closest|nearby)\b/.test(lower)) return '';
  if (/\b(pharmacy|drugstore)\b/.test(lower)) return 'pharmacy';
  if (/\b(grocery|supermarket|market)\b/.test(lower)) return 'grocery';
  if (/\b(cafe|coffee)\b/.test(lower)) return 'cafe';
  if (/\b(bar|pub)\b/.test(lower)) return 'bar';
  if (/\b(restaurant|food)\b/.test(lower)) return 'restaurant';
  if (/\b(store|shop|place)\b/.test(lower)) return 'store';
  return '';
}

function parseNamedPlaceRequest(location = '') {
  const text = String(location).trim();
  if (!text) return null;
  const brands = [
    { pattern: /\bstarbucks\b/i, name: 'Starbucks', kind: 'cafe' },
    { pattern: /\bmcdonald'?s\b/i, name: "McDonald's", kind: 'restaurant' },
    { pattern: /\bwalmart\b/i, name: 'Walmart', kind: 'store' },
    { pattern: /\btarget\b/i, name: 'Target', kind: 'store' },
    { pattern: /\bcostco\b/i, name: 'Costco', kind: 'store' }
  ];
  return brands.find(brand => brand.pattern.test(text)) || null;
}

function parseVoiceReminder(text) {
  const contactText = normalizeSpokenRecipientText(text);
  const recipients = classifyRecipients(contactText).values.filter(value => isPhone(value) || isEmail(value));
  const date = parseVoiceDate(text);
  const time = parseVoiceTime(text);
  const location = parseVoiceLocation(text);
  const nearestPlace = parseNearestPlaceRequest(text);
  let title = stripSpokenDatePhrases(text)
    .replace(/[^\s,;<>]+@[^\s,;<>]+\.[^\s,;<>]+/gi, ' ')
    .replace(/\+?\d[\d\s().-]{5,}\d/g, ' ')
    .replace(/\b(remind me to|remind me|create a reminder to|create a reminder|schedule)\b/gi, ' ')
    .replace(/\b(?:at|around)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, ' ')
    .replace(/\b(?:at|near|in)\s+[^,.]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Remove a no-preposition location (e.g. "California, USA") from the title so it doesn't linger there.
  if (location) {
    const escaped = location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title
      .replace(new RegExp(escaped + '\\.?', 'i'), ' ')
      .replace(/\s+,/g, ',')
      .replace(/[,.\s]+$/,'')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!title || title.length < 3) title = text.split(/\b(?:tomorrow|today|next\s+\w+|at\s+\d{1,2})\b/i)[0].replace(/remind me( to)?/i, '').trim();
  return { title, date, time, location, recipients, nearestPlace };
}

const AREA_CODE_CENTERS = {
  '808': { label: 'Honolulu, HI', lat: 21.3069, lng: -157.8583 },
  '212': { label: 'New York, NY', lat: 40.7128, lng: -74.0060 },
  '310': { label: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  '415': { label: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 }
};

function areaCenterFromRecipients(values = []) {
  for (const value of values) {
    const digits = String(value).replace(/\D/g, '');
    const area = digits.length === 11 && digits.startsWith('1') ? digits.slice(1, 4) : digits.slice(0, 3);
    if (AREA_CODE_CENTERS[area]) return AREA_CODE_CENTERS[area];
  }
  return null;
}

function poiMatchesKind(poi, kind, brandName = '') {
  const category = String(poi?.category || '').toLowerCase();
  const name = String(poi?.name || '').toLowerCase();
  const brand = String(poi?.brand || '').toLowerCase();
  const text = `${category} ${name} ${brand}`;
  if (brandName && !text.includes(brandName.toLowerCase())) return false;
  if (kind === 'grocery') return /supermarket|convenience|grocery|market/.test(text);
  if (kind === 'store') return category && !/restaurant|cafe|bar|pub|fast_food/.test(category);
  return text.includes(kind) || (kind === 'restaurant' && /restaurant|fast_food|food/.test(text));
}

function listContacts(values = []) {
  return values.length ? values.join(', ') : 'none';
}

function describeInvalidContact(value) {
  const text = String(value || '').trim();
  if (text.includes('@')) {
    const reason = getEmailValidationError(text);
    return reason ? `${text} (${reason})` : text;
  }
  const digits = text.replace(/\D/g, '');
  if (digits && !isPhone(text)) return `${text} (phone number is incomplete or has the wrong digit count)`;
  return text;
}

function buildValidationFailureMessage(invalid, phones, emails) {
  const described = invalid.map(describeInvalidContact);
  return `Delivery failed before sending. Invalid contact${invalid.length === 1 ? '' : 's'}: ${listContacts(described)}. Recognized contacts — text: ${listContacts(phones)}; email: ${listContacts(emails)}.`;
}

function buildComposeConfirmationMessage(channel, contacts) {
  const label = channel === 'email' ? 'email compose' : channel === 'text' ? 'text message app' : 'share sheet';
  return `Confirmation: ${label} opened for ${listContacts(contacts)}. Delivery is pending until you press Send in that app.`;
}

function RecipientPanel({ reminder, onClose, onPreview, collapsed = false, onRecipientsChange, onValidRecipientsChange, showRecipientsInPreview, onShowRecipientsChange, initialRecipientText = '' }) {
  const [recipientRows, setRecipientRows] = useState(() => rowsFromRecipientText(initialRecipientText));
  const [message, setMessage] = useState('');
  const [recipientNotice, setRecipientNotice] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [secondaryEmailLink, setSecondaryEmailLink] = useState('');
  const [recipientListening, setRecipientListening] = useState(false);
  const recipientRecognitionRef = useRef(null);
  const [recipientVoiceText, setRecipientVoiceText] = useState('');
  const { values: recipients, phones, emails, invalid, contacts, labels: recipientLabels, duplicates } = classifyRecipientRows(recipientRows);
  const namedRecipientCount = contacts.filter(contact => contact.name).length;
  const valid = recipients.length > 0 && invalid.length === 0;
  const hasRecipientText = recipientRows.some(row => row.trim());
  const route = phones.length ? 'text' : emails.length ? 'email' : '';

  function commitRecipientRows(rows, notice = '') {
    const normalized = normalizeRecipientRows(rows);
    setRecipientRows(normalized.rows);
    setMessage('');
    setSecondaryEmailLink('');
    setRecipientNotice(normalized.duplicates.length ? `Removed ${normalized.duplicates.length} duplicate recipient${normalized.duplicates.length === 1 ? '' : 's'}.` : notice);
  }

  function updateRecipientRow(index, value, formatNow = false) {
    const next = [...recipientRows];
    next[index] = value;
    if (formatNow) commitRecipientRows(next.map(row => smartFormatRecipients(row)));
    else {
      setRecipientRows(next);
      setMessage('');
      setSecondaryEmailLink('');
      setRecipientNotice('');
    }
  }

  function handleRecipientPaste(index, event) {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') || '';
    const next = [...recipientRows];
    next[index] = next[index] ? `${next[index]}, ${pasted}` : pasted;
    commitRecipientRows(next.map(row => smartFormatRecipients(row)));
  }

  function addRecipientRow() {
    setRecipientRows(rows => [...rows, '']);
    setRecipientNotice('');
  }

  function removeRecipientRow(index) {
    const next = recipientRows.filter((_, rowIndex) => rowIndex !== index);
    commitRecipientRows(next.length ? next : ['']);
  }


  async function pickDeviceContactFromVoice(query = '') {
    if (!navigator.contacts?.select) {
      setRecipientNotice('Voice captured. Device contact search is not supported here, so speak or type the phone number/email address.');
      return false;
    }
    try {
      const selected = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
      const rows = rowsFromDeviceContacts(selected);
      if (!rows.length) {
        setRecipientNotice('No phone number or email address was selected from contacts.');
        return false;
      }
      commitRecipientRows([...recipientRows.filter(row => row.trim()), ...rows], `Voice contact search added ${rows.length} contact entr${rows.length === 1 ? 'y' : 'ies'}.`);
      return true;
    } catch {
      setRecipientNotice('Contact search was cancelled or unavailable.');
      return false;
    }
  }

  async function applyRecipientVoiceTranscript(transcript) {
    const normalized = normalizeSpokenRecipientText(transcript);
    setRecipientVoiceText(transcript);
    const rows = rowsFromVoiceRecipientText(transcript);
    const classified = classifyRecipientRows(rows);
    if (classified.values.length || classified.invalid.length) {
      commitRecipientRows([...recipientRows.filter(row => row.trim()), ...rows], `Voice captured: “${transcript}”`);
      return;
    }
    if (isContactSearchRequest(transcript)) {
      await pickDeviceContactFromVoice(transcript);
      return;
    }
    setRecipientNotice(`Voice captured: “${transcript}”. Say a phone number, an email address, or ask to search contacts.`);
  }

  async function startRecipientVoiceSearch() {
    // Tap again while listening = stop (native mic now runs continuously).
    if (recipientRecognitionRef.current) {
      try { recipientRecognitionRef.current.stop?.(); } catch {}
      recipientRecognitionRef.current = null;
      return;
    }
    const nativeCtrl = await startNativeSpeech({
      lang: navigator.language || 'en-US',
      onStart: () => { setRecipientListening(true); setRecipientVoiceText(''); setRecipientNotice('Listening… tap the mic again when you are done.'); },
      onPartial: (t) => { if (t) { setRecipientVoiceText(t); setRecipientNotice(`Heard: \u201c${t}\u201d`); } },
      onFinal: (t) => { if (t) applyRecipientVoiceTranscript(t); },
      onError: (m) => setRecipientNotice(m),
      onEnd: () => { recipientRecognitionRef.current = null; window.setTimeout(() => setRecipientListening(false), 300); },
    });
    if (nativeCtrl) { recipientRecognitionRef.current = nativeCtrl; return; }
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setRecipientNotice('Voice-to-text is not supported in this browser. Try Chrome, Edge, or Safari with microphone permission.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { setRecipientListening(true); setRecipientVoiceText(''); setRecipientNotice('Listening for contact name, phone, or email…'); };
    recognition.onerror = event => { window.setTimeout(() => setRecipientListening(false), 500); setRecipientNotice(`Contact voice capture stopped: ${event.error || 'microphone unavailable'}.`); };
    recognition.onend = () => window.setTimeout(() => setRecipientListening(false), 500);
    recognition.onresult = event => {
      const transcript = Array.from(event.results || []).map(result => result[0]?.transcript || '').join(' ').trim();
      if (transcript) {
        setRecipientVoiceText(transcript);
        setRecipientNotice(`Heard: “${transcript}”`);
      }
      const finalTranscript = Array.from(event.results || []).filter(result => result.isFinal).map(result => result[0]?.transcript || '').join(' ').trim();
      if (finalTranscript) applyRecipientVoiceTranscript(finalTranscript);
    };
    recognition.start();
  }

  useEffect(() => {
    onRecipientsChange?.(showRecipientsInPreview ? recipientLabels : []);
  }, [recipientRows, showRecipientsInPreview]);

  useEffect(() => {
    onValidRecipientsChange?.(valid);
  }, [valid]);

  useEffect(() => {
    if (initialRecipientText) commitRecipientRows(rowsFromRecipientText(initialRecipientText).map(row => smartFormatRecipients(row)));
  }, [initialRecipientText]);

  async function share() {
    setSecondaryEmailLink('');
    if (invalid.length) {
      setMessage(buildValidationFailureMessage(invalid, phones, emails));
      return;
    }
    if (!recipients.length) {
      setMessage('Delivery failed before sending. No recipient was entered.');
      return;
    }

    const deliveryRecipients = recipients;
    const displayRecipients = recipientLabels.length ? recipientLabels : recipients;
    setMessage('Creating independent shared reminder file on the server…');
    try {
      const payload = normalizeReminder({ ...reminder, recipients: displayRecipients, permission: 'shared-edit' });
      const saved = await reminderSync({
        action: 'save',
        editor: reminder.sender || 'sender',
        channel: phones.length ? 'sms-share' : 'email-share',
        recipients: deliveryRecipients,
        payload
      });
      const token = saved.share_token || saved.reminder?.share_token;
      const url = buildShareUrl(token);
      const savedVersion = Number(saved.reminder?.version || saved.version || payload.version || 1);
      let sharedReminder = { ...payload, share_token: token, shareUrl: url, version: savedVersion };
      setShareUrl(url);
      // Schedule a local notification 15 minutes before the meeting/appointment time (native only).
      try {
        await scheduleReminderNotification({
          id: token,
          share_token: token,
          title: sharedReminder.title,
          date: sharedReminder.date,
          time: sharedReminder.time,
          location: sharedReminder.location
        });
      } catch (notifyErr) { /* non-fatal: notifications are best-effort */ }

      if (phones.length) {
        if (emails.length) setSecondaryEmailLink(createMailto(sharedReminder, emails));
        setMessage(`${buildComposeConfirmationMessage('text', phones)}${emails.length ? ' Email recipient also recognized — open email after the text app if needed.' : ''}`);
        window.location.href = createSmsLink(sharedReminder, phones);
        return;
      }

      if (emails.length) {
        setMessage(buildComposeConfirmationMessage('email', emails));
        window.location.href = createMailto(sharedReminder, emails);
        return;
      }
    } catch (error) {
      setMessage(error.message || 'Could not create the shared reminder file.');
    }
  }

  const previewAction = onPreview || onClose;

  return <aside className={`send-panel ${collapsed ? 'collapsed-preview' : ''}`} aria-label={collapsed ? 'Collapsed send options panel' : 'Send options panel'}>
    <div className="panel-header compact send-options-header"><div><p className="eyebrow tiny">Send options</p><h2>Send reminder</h2></div><div className="send-options-header-actions"><button type="button" className={`mic-button recipient-mic-button ${recipientListening ? 'listening' : ''}`} style={recipientListening ? { '--mic-bg': '#dcfce7', '--mic-fg': '#16a34a' } : undefined} onClick={startRecipientVoiceSearch} aria-label="Speak or search contact"><Mic size={17}/></button><button type="button" className="send-panel-close" aria-label="Close Send Reminder panel" onClick={onClose}><X size={16}/></button></div></div>
    <p className="panel-copy">Type or speak names with phone numbers or email addresses.</p>
    {recipientVoiceText && <p className="recipient-voice-status">Heard: “{recipientVoiceText}”</p>}
    <Field label={<span className="recipient-label-row"><span>Recipient</span><span className="recipient-show-toggle"><input type="checkbox" checked={showRecipientsInPreview} onChange={e => onShowRecipientsChange?.(e.target.checked)} aria-label="Show recipient in Preview" /> Show</span></span>} error={invalid.length ? 'Fix the red recipient before sending.' : ''} hint={valid ? `${recipients.length} validated recipient${recipients.length === 1 ? '' : 's'}${namedRecipientCount ? ` · ${namedRecipientCount} name${namedRecipientCount === 1 ? '' : 's'} identified` : ''} · ${phones.length ? `${phones.length} text message${phones.length === 1 ? '' : 's'}` : ''}${phones.length && emails.length ? ' · ' : ''}${emails.length ? `${emails.length} email${emails.length === 1 ? '' : 's'}` : ''}` : 'One contact per row. Add another row for multiple contacts.'}>
      <div className="recipient-row-list">
        {recipientRows.map((row, index) => {
          const rowClassified = classifyRecipients(row);
          const rowInvalid = row.trim() && (rowClassified.invalid.length || rowClassified.values.length > 1);
          return <div className={`recipient-entry-row ${rowInvalid ? 'invalid' : ''}`} key={index}>
            <input value={row} onChange={e => updateRecipientRow(index, e.target.value)} onPaste={e => handleRecipientPaste(index, e)} onBlur={e => updateRecipientRow(index, e.target.value, true)} aria-label={`Recipient ${index + 1}`} placeholder={index === 0 ? 'Name + one phone/email' : 'Another phone/email'} />
            {recipientRows.length > 1 && <button type="button" className="ghost recipient-row-remove" aria-label={`Remove recipient ${index + 1}`} onClick={() => removeRecipientRow(index)}><X size={14}/></button>}
          </div>;
        })}
        <button type="button" className="secondary full add-recipient-row" onClick={addRecipientRow}>Add another contact</button>
      </div>
      {recipientNotice && <small className="recipient-notice">{recipientNotice}</small>}
    </Field>
    <div className={`recognition-banner compact ${valid ? 'valid' : invalid.length ? 'invalid' : ''}`} role="status" aria-live="polite">
      {valid ? <><CheckCircle2 size={15}/> Ready: {namedRecipientCount ? `${namedRecipientCount} name${namedRecipientCount === 1 ? '' : 's'} · ` : ''}{phones.length ? `${phones.length} text` : ''}{phones.length && emails.length ? ' · ' : ''}{emails.length ? `${emails.length} email` : ''}</> : invalid.length ? <><AlertTriangle size={15}/> Fix unrecognized entry before Send.</> : <><Sparkles size={15}/> Smart field recognizes typed names, phones, and emails.</>}
    </div>
    <div className="modal-actions button-hierarchy"><button type="button" className="secondary cancel preview-collapse-action" onClick={previewAction}>{collapsed ? 'Back' : 'Preview'}</button><button type="button" className="primary send-dominant" onClick={share} disabled={!hasRecipientText}>Send</button></div>
    {message && <p className={!message.toLowerCase().includes('failed') && !message.toLowerCase().includes('could not') ? 'success' : 'field-error block'}>{message}</p>}
    {secondaryEmailLink && <button type="button" className="secondary full" onClick={() => { window.location.href = secondaryEmailLink; }}>Open email for email recipient</button>}
  </aside>;
}

function App() {
  const [selfRepairReport, setSelfRepairReport] = useState(() => inspectAndRepairStoredState());
  const [runtimeIssue, setRuntimeIssue] = useState(null);
  const [form, setForm] = useState(initialReminder);
  const [reminders, setReminders] = useState(() => readStoredValue(PREVIEW_REMINDERS_KEY, [initialReminder]));
  const [sendOpen, setSendOpen] = useState(false);
  const [sendCollapsed, setSendCollapsed] = useState(false);
  // When the Send bar is docked as a collapsed Back/Send bar, flag the body so
  // the preview card underneath gets bottom padding and can scroll fully clear
  // of the fixed bar (mirrors the recipient-edit bottom-bar behavior).
  useEffect(() => {
    const active = sendOpen && sendCollapsed;
    document.body.classList.toggle('sir-send-collapsed', active);
    return () => document.body.classList.remove('sir-send-collapsed');
  }, [sendOpen, sendCollapsed]);
  // Standard-mode mobile stacked-steps front card: 1=Create, 2=Preview, 3=Send. Default Preview on top.
  const [stepFront, setStepFront] = useState(2);
  const [reviewTabsReady, setReviewTabsReady] = useState(false);
  const [sharedPackage, setSharedPackage] = useState(null);
  const [sharedCoverDismissed, setSharedCoverDismissed] = useState(false);
  const [sharedCoverFading, setSharedCoverFading] = useState(false);
  const [sharedStatus, setSharedStatus] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [locationToolsOpen, setLocationToolsOpen] = useState(false);
  const [recipientEditOpen, setRecipientEditOpen] = useState(false);
  const [recipientPreviewMode, setRecipientPreviewMode] = useState(false);
  const [lastSharedSummary, setLastSharedSummary] = useState('');
  const [lastSharedMeta, setLastSharedMeta] = useState(null);
  const [locationStatus, setLocationStatus] = useState('');
  const [previewIndex, setPreviewIndex] = useState(() => readStoredValue(PREVIEW_SETTINGS_KEY, { activeIndex: 0 })?.activeIndex || 0);
  const [showRecipientsInPreview, setShowRecipientsInPreview] = useState(() => readStoredValue(PREVIEW_SETTINGS_KEY, { showRecipientsInPreview: false })?.showRecipientsInPreview || false);
  const [previewTimezone, setPreviewTimezone] = useState(() => readStoredValue(PREVIEW_SETTINGS_KEY, { previewTimezone: 'HST' })?.previewTimezone || 'HST');
  const [displayMode, setDisplayMode] = useState(() => readStoredValue(PREVIEW_SETTINGS_KEY, { displayMode: 'compact' })?.displayMode === 'standard' ? 'standard' : 'compact');
  const [previewRecipients, setPreviewRecipients] = useState(() => readStoredValue(PREVIEW_RECIPIENTS_KEY, []));
  const [previewMotionKey, setPreviewMotionKey] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [previewVoiceTargetIndex, setPreviewVoiceTargetIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [locationListening, setLocationListening] = useState(false);
  const [addressMicVisible, setAddressMicVisible] = useState(false);
  const [voiceRecipientText, setVoiceRecipientText] = useState('');
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [previewEditOpen, setPreviewEditOpen] = useState(false);
  const [previewLocationToolsOpen, setPreviewLocationToolsOpen] = useState(false);
  const [settingsPopup, setSettingsPopup] = useState(null);
  const sharedLocationSaveRef = useRef({ time: 0, signature: '' });
  const recognitionRef = useRef(null);
  const previewVoiceTargetRef = useRef(null);
  const locationRecognitionRef = useRef(null);
  const compactAutoLocationAttempted = useRef(false);
  const fieldRefs = useRef([]);
  const savedReminder = reminders[0];
  const effectiveForm = useMemo(() => ({ ...form, title: form.title.trim() || placeholderReminderTitle }), [form]);
  const activeReminder = useMemo(() => {
    const normalized = normalizeReminder(effectiveForm);
    return { ...normalized, location: effectiveForm.location?.trim() || '', locationPin: effectiveForm.locationPin || null, urgencySelected: form.urgencySelected };
  }, [effectiveForm, form.urgencySelected]);
  const smartInsight = useMemo(() => deriveSmartInsights(form), [form]);
  const previewReminders = useMemo(() => {
    const cards = [activeReminder];
    reminders.forEach(item => {
      const normalized = normalizeReminder(item);
      if (!cards.some(card => card.id === normalized.id || sameReminderCard(card, normalized))) cards.push(normalized);
    });
    const blankBackgroundCard = { ...initialReminder, id: BACKGROUND_BLANK_REMINDER_ID, title: '', location: '', locationPin: null, sharedLocations: [], notes: '', urgency: 'low', urgencySelected: false };
    if (!cards.some(card => card.id === BACKGROUND_BLANK_REMINDER_ID) && !cards.some(isBlankPreviewCard)) cards.push(blankBackgroundCard);
    return cards.slice(0, 7);
  }, [activeReminder, reminders]);
  const currentPreviewIndex = Math.min(previewIndex, Math.max(previewReminders.length - 1, 0));
  const previewReminder = previewReminders[currentPreviewIndex] || activeReminder;
  const mapEmbedUrl = useMemo(() => {
    const pin = form.locationPin;
    if (!pin) return '';
    const lat = Number(pin.lat);
    const lng = Number(pin.lng);
    const pad = 0.01;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - pad}%2C${lat - pad}%2C${lng + pad}%2C${lat + pad}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [form.locationPin]);
  const mapSearchUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(form.location || '')}`;
  const validation = useMemo(() => ({
    title: form.title.trim() && form.title.trim().length < 3 ? 'Add at least 3 characters.' : '',
    due: !isFutureDue(form) ? 'Pick a future date and time.' : ''
  }), [form]);
  const formValid = Object.values(validation).every(error => !error);
  const isSharedRecipient = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('share');
  const compactMode = displayMode !== 'standard';


  useEffect(() => { writeStoredValue(PREVIEW_REMINDERS_KEY, reminders.slice(0, 7)); }, [reminders]);
  useEffect(() => { writeStoredValue(PREVIEW_RECIPIENTS_KEY, previewRecipients); }, [previewRecipients]);
  useEffect(() => { writeStoredValue(PREVIEW_SETTINGS_KEY, { showRecipientsInPreview, activeIndex: currentPreviewIndex, previewTimezone, displayMode }); }, [showRecipientsInPreview, currentPreviewIndex, previewTimezone, displayMode]);
  useEffect(() => {
    const onError = event => {
      const entry = recordClientIssue('runtime-error', event.message || event.error?.message || 'Runtime issue', { filename: event.filename, lineno: event.lineno, colno: event.colno });
      setRuntimeIssue(entry);
    };
    const onRejection = event => {
      const reason = event.reason?.message || event.reason || 'Background task failed';
      const entry = recordClientIssue('unhandled-promise', reason, {});
      setRuntimeIssue(entry);
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  useEffect(() => {
    if (previewIndex >= previewReminders.length) setPreviewIndex(Math.max(previewReminders.length - 1, 0));
  }, [previewIndex, previewReminders.length]);

  useEffect(() => {
    window.__SIR_TEST_VOICE__ = applyVoiceTranscript;
    return () => { delete window.__SIR_TEST_VOICE__; };
  });

  function showPreviousPreviewCard() {
    setPreviewIndex(index => previewReminders.length ? (index - 1 + previewReminders.length) % previewReminders.length : 0);
    setPreviewMotionKey(key => key + 1);
  }

  function showNextPreviewCard() {
    setPreviewIndex(index => previewReminders.length ? (index + 1) % previewReminders.length : 0);
    setPreviewMotionKey(key => key + 1);
  }

  function deletePreviewCard() {
    const cardToDelete = previewReminder;
    const deletingActive = currentPreviewIndex === 0 || sameReminderCard(activeReminder, cardToDelete);
    const remainingSaved = reminders.filter(item => !sameReminderCard(normalizeReminder(item), cardToDelete));
    if (deletingActive) {
      const nextCard = previewReminders.find((card, index) => index !== currentPreviewIndex && !sameReminderCard(card, cardToDelete));
      if (nextCard) {
        setForm(nextCard);
        setReminders(remainingSaved);
        setPreviewIndex(0);
      } else {
        setForm(initialReminder);
        setReminders([]);
        setPreviewIndex(0);
      }
    } else {
      setReminders(remainingSaved);
      setPreviewIndex(index => Math.max(0, Math.min(index, Math.max(previewReminders.length - 2, 0))));
    }
    setPreviewMotionKey(key => key + 1);
  }

  // On a native device, request notification permission up-front and keep the
  // app-icon badge in sync with pending reminders whenever the app becomes active.
  useEffect(() => {
    ensureNotifyPermission().catch(() => {});
    syncAppBadge().catch(() => {});
    const onVisible = () => { if (document.visibilityState === 'visible') syncAppBadge().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shareToken = params.get('share');
    if (!shareToken) return;
    let cancelled = false;
    setSharedStatus('Loading shared reminder file…');
    reminderSync({ action: 'fetch', share_token: shareToken, recipient: 'shared-recipient' })
      .then(data => {
        if (cancelled) return;
        const record = data.reminder;
        const payload = record.payload || {};
        setForm({ ...normalizeReminder(payload), ...payload, title: payload.title || placeholderReminderTitle });
        setReminders([record.payload || payload]);
        setSharedPackage({ token: record.share_token, version: record.version, lastEditor: record.last_editor, editCount: record.edit_history?.length || 0, expiresAt: record.expires_at });
        setLastSharedSummary('');
        setLastSharedMeta(null);
        setSharedCoverDismissed(false);
        setSharedCoverFading(false);
        setSharedStatus(`Shared file loaded · version ${record.version}${record.last_editor ? ` · last edited by ${record.last_editor}` : ''}`);
        // Recipient gets the 15-minute-before alert for the shared reminder (native only).
        scheduleReminderNotification({
          id: record.share_token,
          share_token: record.share_token,
          title: payload.title,
          date: payload.date,
          time: payload.time,
          location: payload.location
        }).catch(() => {});
      })
      .catch(error => {
        if (cancelled) return;
        setSharedStatus(error.data?.expired ? 'This shared reminder expired and was removed from the server.' : (error.message || 'Shared reminder could not be loaded.'));
      });
    return () => { cancelled = true; };
  }, []);

  function openSharedReminderFromScreenshot() {
    setSharedCoverFading(true);
    window.setTimeout(() => {
      setSharedCoverDismissed(true);
      setSharedCoverFading(false);
    }, 420);
  }


  async function saveSharedLocationUpdate(point) {
    if (!sharedPackage?.token || !point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return;
    const now = Date.now();
    const signature = `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`;
    if (sharedLocationSaveRef.current.signature === signature && now - sharedLocationSaveRef.current.time < 12000) return;
    sharedLocationSaveRef.current = { time: now, signature };
    const participant = chooseSharedParticipantColor(getSharedParticipant(sharedPackage.token), activeReminder.sharedLocations);
    const nextLocation = {
      ...participant,
      lat: Number(point.lat),
      lng: Number(point.lng),
      accuracy: Math.round(Number(point.accuracy || 0)),
      heading: Math.round(Number(point.heading || 0)),
      updatedAt: new Date().toISOString()
    };
    const payload = normalizeReminder({
      ...activeReminder,
      share_token: sharedPackage.token,
      version: sharedPackage.version,
      permission: 'shared-edit',
      sharedLocations: mergeSharedLocation(activeReminder.sharedLocations, nextLocation)
    });
    setForm(prev => ({ ...prev, sharedLocations: payload.sharedLocations }));
    setReminders(prev => prev.map((item, index) => index === currentPreviewIndex ? { ...item, sharedLocations: payload.sharedLocations } : item));
    setSharedStatus(`${participant.name} shared location · updating colored routes…`);
    try {
      const data = await reminderSync({
        action: 'save',
        share_token: sharedPackage.token,
        version: sharedPackage.version,
        editor: participant.name,
        channel: 'shared-location',
        changed_fields: ['sharedLocations'],
        payload
      });
      const record = data.reminder;
      const savedPayload = record.payload || payload;
      setSharedPackage({ token: record.share_token, version: record.version, lastEditor: record.last_editor, editCount: record.edit_history?.length || 0, expiresAt: record.expires_at });
      setForm(prev => ({ ...prev, sharedLocations: savedPayload.sharedLocations || payload.sharedLocations }));
      setReminders(prev => prev.map((item, index) => index === currentPreviewIndex ? { ...item, sharedLocations: savedPayload.sharedLocations || payload.sharedLocations } : item));
      setSharedStatus(`${participant.name} shared location · colored route synced`);
    } catch (error) {
      setSharedStatus(`Location shown on this device, but server sync failed: ${error.message || 'try again'}`);
    }
  }

  async function saveSharedChanges() {
    if (!sharedPackage || !formValid) return;
    setSharedStatus('Saving shared schedule/location changes…');
    try {
      const payload = normalizeReminder({ ...activeReminder, share_token: sharedPackage.token, version: sharedPackage.version, permission: 'shared-edit' });
      const data = await reminderSync({
        action: 'save',
        share_token: sharedPackage.token,
        version: sharedPackage.version,
        editor: 'shared-recipient',
        channel: 'shared-edit',
        changed_fields: ['date', 'time', 'location', 'locationPin'],
        payload
      });
      const record = data.reminder;
      const savedPayload = record.payload || payload;
      const lastEdit = record.edit_history?.[record.edit_history.length - 1];
      setSharedPackage({ token: record.share_token, version: record.version, lastEditor: record.last_editor, editCount: record.edit_history?.length || 0, expiresAt: record.expires_at });
      setLastSharedSummary(`Changes saved: ${formatDue(savedPayload)} · ${savedPayload.location || 'No location set'}`);
      setLastSharedMeta({ editor: lastEdit?.editor || record.last_editor || 'shared-recipient', at: lastEdit?.at || new Date().toISOString() });
      setRecipientEditOpen(false);
      setMapOpen(false);
      setSharedStatus(`Shared changes saved · version ${record.version}`);
      // Recipient also gets a 15-minute-before notification on their device (native only).
      try {
        await scheduleReminderNotification({
          id: record.share_token,
          share_token: record.share_token,
          title: savedPayload.title,
          date: savedPayload.date,
          time: savedPayload.time,
          location: savedPayload.location
        });
      } catch (notifyErr) { /* best-effort */ }
    } catch (error) {
      if (error.data?.conflict && error.data.current?.payload) {
        const current = error.data.current;
        setForm({ ...normalizeReminder(current.payload), ...current.payload });
        setSharedPackage({ token: current.share_token, version: current.version, lastEditor: current.last_editor, editCount: current.edit_history?.length || 0, expiresAt: current.expires_at });
        setLastSharedSummary('');
        setLastSharedMeta(null);
        setSharedCoverDismissed(false);
        setSharedCoverFading(false);
        setSharedStatus('Someone else saved a newer version. I loaded the latest shared file.');
        return;
      }
      setSharedStatus(error.data?.expired ? 'This shared reminder expired and was removed from the server.' : (error.message || 'Could not save shared changes.'));
    }
  }

  function setField(field, value) {
    setForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === 'location') {
        next.locationPin = null;
        setLocationStatus('');
      }
      if (field === 'urgency') next.urgencySelected = true;
      if (field === 'title') {
        const lower = value.toLowerCase();
        if ((lower.includes('call') || lower.includes('zoom') || lower.includes('meeting')) && ['Video call / online link', 'Online meeting link'].includes(prev.location)) next.location = 'Video call / online link';
        if (lower.includes('deadline') || lower.includes('urgent')) next.urgency = 'urgent';
      }
      return next;
    });
  }
  function applyRecognizedRecipientRows(rows) {
    const normalized = normalizeRecipientRows(rows).rows;
    const text = normalized.join(', ');
    if (!text.trim()) return;
    const classified = classifyRecipientRows(normalized);
    setVoiceRecipientText(text);
    setPreviewRecipients(classified.labels.length ? classified.labels : classified.values);
    setSendOpen(true);
  }

  function applyRecognizedRecipients(values) {
    applyRecognizedRecipientRows(rowsFromRecipientText(values.join(', ')).map(row => smartFormatRecipients(row)));
  }

  async function resolveNearestSmartPlace(kind, recipientValues = [], brandName = '') {
    setLocationToolsOpen(true);
    const searchLabel = brandName || kind;
    setLocationStatus(`Smart Mode searching for nearest ${searchLabel}…`);
    let center = null;
    let source = '';
    if (navigator.geolocation) {
      try {
        const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 7000, maximumAge: 60000 }));
        center = { lat: position.coords.latitude, lng: position.coords.longitude, label: 'GPS location', accuracy: position.coords.accuracy || 0 };
        source = 'GPS';
      } catch {
        center = null;
      }
    }
    if (!center) {
      center = areaCenterFromRecipients(recipientValues);
      source = center ? `area code near ${center.label}` : '';
    }
    if (!center) {
      setLocationStatus('Smart Mode needs GPS or a recognized phone area code to find a nearby place.');
      return;
    }
    const pois = await fetchNearbyPois(center, brandName ? 5000 : 1400);
    let place = pois.find(poi => poiMatchesKind(poi, kind, brandName)) || (!brandName ? pois.find(poi => poiMatchesKind(poi, kind)) : null) || (!brandName ? pois[0] : null);
    if (!place && brandName) place = await searchNamedPlaceNear(brandName, center);
    if (!place) {
      const fallback = `Nearest ${searchLabel} near ${center.label}`;
      updatePreviewVoiceTarget(prev => ({ ...prev, location: fallback, locationPin: { lat: center.lat, lng: center.lng, accuracy: Math.round(center.accuracy || 0), address: fallback } }));
      setMapOpen(true);
      setLocationStatus(`Smart Mode used ${source}; no named ${searchLabel} found nearby.`);
      return;
    }
    const address = place.address || `${place.name} · ${place.category}`;
    updatePreviewVoiceTarget(prev => ({ ...prev, location: address, locationPin: { lat: place.lat, lng: place.lng, accuracy: Math.round(center.accuracy || 0), address } }));
    setMapOpen(true);
    setLocationStatus(`Smart Mode selected ${place.name || searchLabel} from ${source}.`);
  }


  function startPreviewVoiceFill() {
    previewVoiceTargetRef.current = { index: currentPreviewIndex, id: previewReminder.id, reminder: previewReminder };
    setPreviewVoiceTargetIndex(currentPreviewIndex);
    // Clear the displayed reminder text so voice input starts fresh
    setForm(prev => ({ ...prev, title: '' }));
    setVoiceTranscript('');
    startVoiceFill();
  }

  function updatePreviewVoiceTarget(updater) {
    const target = previewVoiceTargetRef.current || { index: 0, id: activeReminder.id, reminder: activeReminder };
    if (target.id === BACKGROUND_BLANK_REMINDER_ID) {
      setForm(prev => updater({ ...initialReminder, id: prev.id || initialReminder.id }));
      setPreviewIndex(0);
      return;
    }
    if (target.index > 0) {
      setReminders(prev => {
        let updated = false;
        const next = prev.map(item => {
          const normalized = normalizeReminder(item);
          const matchesTarget = normalized.id === target.id || item.id === target.id || (!updated && sameReminderCard(normalized, target.reminder));
          if (!matchesTarget) return item;
          updated = true;
          return updater({ ...normalized, ...item });
        });
        return updated ? next : prev;
      });
      return;
    }
    setForm(prev => updater(prev));
  }

  async function applyVoiceTranscript(transcript) {
    const parsed = parseVoiceReminder(transcript);
    const namedPlace = parseNamedPlaceRequest(parsed.location);
    setVoiceTranscript(transcript);
    setVoiceStatus(`Heard: “${transcript}”`);
    updatePreviewVoiceTarget(prev => ({
      ...prev,
      title: parsed.title || prev.title,
      date: parsed.date || prev.date,
      time: parsed.time || prev.time,
      location: parsed.location && !namedPlace ? parsed.location : prev.location,
      locationPin: parsed.location && !namedPlace ? null : prev.locationPin
    }));
    if (parsed.location && !namedPlace) {
      const geocoded = await forwardGeocode(parsed.location);
      if (geocoded) updatePreviewVoiceTarget(prev => prev.location === parsed.location ? { ...prev, locationPin: { ...geocoded, address: parsed.location } } : prev);
    }
    if (parsed.recipients.length) applyRecognizedRecipients(parsed.recipients);
    else if (isContactSearchRequest(transcript)) await pullSmartContacts(transcript);
    if (namedPlace) await resolveNearestSmartPlace(namedPlace.kind, parsed.recipients, namedPlace.name);
    else if (parsed.nearestPlace) await resolveNearestSmartPlace(parsed.nearestPlace, parsed.recipients);
  }

  function pauseBackgroundMusicForMicrophone() { /* background music removed */ }

  async function startVoiceFill() {
    // Tap again while listening = stop (native mic now runs continuously).
    if (recognitionRef.current) {
      try { recognitionRef.current.stop?.(); } catch {}
      recognitionRef.current = null;
      return;
    }
    // Native app path (Capacitor Android/iOS) — Web Speech API is absent there.
    const nativeCtrl = await startNativeSpeech({
      lang: navigator.language || 'en-US',
      onStart: () => { pauseBackgroundMusicForMicrophone(); setListening(true); setVoiceTranscript(''); setVoiceStatus('Listening… tap the mic again when you are done.'); },
      onPartial: (t) => { if (t) setVoiceTranscript(t); },
      onFinal: (t) => { if (t) applyVoiceTranscript(t); },
      onError: (m) => setVoiceStatus(m),
      onEnd: () => { recognitionRef.current = null; window.setTimeout(() => setListening(false), 300); },
    });
    if (nativeCtrl) { recognitionRef.current = nativeCtrl; return; }
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setVoiceStatus('Voice-to-text is not supported in this browser. Try Chrome, Edge, or Safari with microphone permission.');
      return;
    }
    if (recognitionRef.current) recognitionRef.current.abort?.();
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => { pauseBackgroundMusicForMicrophone(); setListening(true); setVoiceTranscript(''); setVoiceStatus('Listening…'); };
    recognition.onerror = event => { window.setTimeout(() => setListening(false), 1000); setVoiceStatus(`Voice capture stopped: ${event.error || 'microphone unavailable'}.`); };
    recognition.onend = () => window.setTimeout(() => setListening(false), 1000);
    recognition.onresult = event => {
      const transcript = Array.from(event.results || []).map(result => result[0]?.transcript || '').join(' ').trim();
      if (transcript) setVoiceTranscript(transcript);
      const finalTranscript = Array.from(event.results || []).filter(result => result.isFinal).map(result => result[0]?.transcript || '').join(' ').trim();
      if (finalTranscript) applyVoiceTranscript(finalTranscript);
      else if (!transcript) setVoiceStatus('No speech detected. Tap the microphone and try again.');
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  async function startLocationVoiceFill() {
    // Tap again while listening = stop (native mic now runs continuously).
    if (locationRecognitionRef.current) {
      try { locationRecognitionRef.current.stop?.(); } catch {}
      locationRecognitionRef.current = null;
      return;
    }
    const nativeCtrl = await startNativeSpeech({
      lang: navigator.language || 'en-US',
      onStart: () => { pauseBackgroundMusicForMicrophone(); setAddressMicVisible(true); setLocationListening(true); setLocationStatus('Listening for address… tap the mic again when you are done.'); fieldRefs.current[3]?.focus(); },
      onPartial: (t) => { if (t) setForm(prev => ({ ...prev, location: t, locationPin: null })); },
      onFinal: (t) => { if (t) { setForm(prev => ({ ...prev, location: t, locationPin: null })); setLocationStatus('Address captured from voice.'); } },
      onError: (m) => setLocationStatus(m),
      onEnd: () => { locationRecognitionRef.current = null; window.setTimeout(() => setLocationListening(false), 300); },
    });
    if (nativeCtrl) { locationRecognitionRef.current = nativeCtrl; return; }
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      setLocationStatus('Address voice-to-text is not supported in this browser. Try Chrome, Edge, or Safari with microphone permission.');
      return;
    }
    if (recognitionRef.current) recognitionRef.current.abort?.();
    if (locationRecognitionRef.current) locationRecognitionRef.current.abort?.();
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onstart = () => {
      pauseBackgroundMusicForMicrophone();
      setAddressMicVisible(true);
      setLocationListening(true);
      setLocationStatus('Listening for address…');
      fieldRefs.current[3]?.focus();
    };
    recognition.onerror = event => {
      window.setTimeout(() => setLocationListening(false), 500);
      setLocationStatus(`Address capture stopped: ${event.error || 'microphone unavailable'}.`);
    };
    recognition.onend = () => window.setTimeout(() => setLocationListening(false), 500);
    recognition.onresult = event => {
      const transcript = Array.from(event.results || []).map(result => result[0]?.transcript || '').join(' ').trim();
      if (!transcript) return;
      setForm(prev => ({ ...prev, location: transcript, locationPin: null }));
      const finalTranscript = Array.from(event.results || []).filter(result => result.isFinal).map(result => result[0]?.transcript || '').join(' ').trim();
      setLocationStatus(finalTranscript ? 'Address captured from voice.' : 'Listening for address…');
    };
    locationRecognitionRef.current = recognition;
    recognition.start();
  }


  async function pullSmartContacts() {
    if (!navigator.contacts?.select) {
      setVoiceStatus('Smart contacts need the device Contact Picker API. You can still speak or paste phone/email entries.');
      return;
    }
    try {
      const contacts = await navigator.contacts.select(['name', 'tel', 'email'], { multiple: true });
      const rows = rowsFromDeviceContacts(contacts);
      if (!rows.length) {
        setVoiceStatus('No phone or email was selected from contacts.');
        return;
      }
      applyRecognizedRecipientRows(rows);
      setVoiceStatus(`Smart Mode added ${rows.length} contact entr${rows.length === 1 ? 'y' : 'ies'} to Send Options.`);
    } catch {
      setVoiceStatus('Contact selection was cancelled or unavailable.');
    }
  }


  function advance(event, index) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      fieldRefs.current[index + 1]?.focus();
    }
  }
  async function pinLocation(lat, lng, accuracy = 0, options = {}) {
    setLocationToolsOpen(true);
    setMapOpen(true);
    setLocationStatus('Finding address…');
    const address = await reverseGeocode(lat, lng);
    let applied = false;
    setForm(prev => {
      if (options.onlyWhenLocationUnset && !isLocationUnset(prev.location)) return prev;
      applied = true;
      return {
        ...prev,
        location: address,
        locationPin: { lat, lng, accuracy: Math.round(accuracy || 0), address }
      };
    });
    setLocationStatus(applied ? `Pinned: ${address}` : '');
  }
  function useCurrentLocation(options = {}) {
    setLocationStatus('Requesting location…');
    if (!navigator.geolocation) {
      setLocationStatus('Current location is not supported in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords;
      pinLocation(latitude, longitude, accuracy, options);
    }, () => {
      setLocationStatus('Location permission was blocked or unavailable.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }
  function clearLocation() {
    setForm(prev => ({ ...prev, location: '', locationPin: null }));
    setMapOpen(false);
    setAddressMicVisible(false);
    setLocationStatus('Location cleared.');
    fieldRefs.current[3]?.focus();
  }

  useEffect(() => {
    if (!compactMode || form.locationPin || compactAutoLocationAttempted.current) return;
    compactAutoLocationAttempted.current = true;
    useCurrentLocation({ onlyWhenLocationUnset: true });
  }, [compactMode, form.locationPin]);
  function saveReminder() {
    if (!formValid) return;
    const normalized = normalizeReminder({ ...form, title: form.title.trim() || placeholderReminderTitle, version: (savedReminder?.version || 0) + 1 });
    setReminders(prev => [normalized, ...prev.slice(0, 6)]);
    setPreviewIndex(0);
    setForm(normalized);
  }
  function runSelfCheck() {
    const report = inspectAndRepairStoredState({ manual: true });
    setSelfRepairReport(report);
    setRuntimeIssue(null);
    setReminders(readStoredValue(PREVIEW_REMINDERS_KEY, [initialReminder]));
    const settings = readStoredValue(PREVIEW_SETTINGS_KEY, { showRecipientsInPreview, activeIndex: currentPreviewIndex, previewTimezone });
    setShowRecipientsInPreview(Boolean(settings.showRecipientsInPreview));
    setPreviewTimezone(settings.previewTimezone || 'HST');
    setDisplayMode(settings.displayMode === 'standard' ? 'standard' : 'compact');
    setPreviewRecipients(readStoredValue(PREVIEW_RECIPIENTS_KEY, []));
  }

  function resetLocalAppData() {
    [PREVIEW_REMINDERS_KEY, PREVIEW_SETTINGS_KEY, PREVIEW_RECIPIENTS_KEY, ISSUE_LOG_KEY].forEach(key => window.localStorage.removeItem(key));
    setForm(initialReminder);
    setReminders([initialReminder]);
    setPreviewIndex(0);
    setShowRecipientsInPreview(false);
    setPreviewTimezone('HST');
    setPreviewRecipients([]);
    setRuntimeIssue(null);
    setSelfRepairReport({ repairs: ['Local reminder state reset to a clean default.'], issues: [], manual: true, checkedAt: new Date().toISOString() });
  }

  function dismissSelfRepair() {
    setRuntimeIssue(null);
    setSelfRepairReport(report => ({ ...(report || {}), repairs: [], manual: false }));
  }

  function sendReminderFromComposer() {
    if (!formValid) return;
    saveReminder();
    setSendOpen(true);
  }
  function downloadPackage() {
    makeAttachmentFiles(activeReminder).forEach(file => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  if (isSharedRecipient) {
    if (!sharedPackage && (!sharedStatus || sharedStatus?.toLowerCase().includes('loading'))) {
      return <main className="recipient-shell"><section className="recipient-loading">Loading interactive shared reminder…</section></main>;
    }
    if (!sharedPackage && sharedStatus) {
      return <main className="recipient-shell"><section className="recipient-loading error"><AlertTriangle size={18}/> {sharedStatus}</section></main>;
    }
    return <main className={`recipient-shell shared-object-only ${recipientEditOpen ? 'recipient-editing-active' : ''}`}>
      {!sharedCoverDismissed && <button type="button" className={`shared-screenshot-cover ${sharedCoverFading ? 'fade-out' : ''}`} onClick={openSharedReminderFromScreenshot} aria-label="Open shared reminder file">
        <span className="screenshot-device-bar"><span></span><span></span><span></span></span>
        <span className="screenshot-card-preview" data-share-token={sharedPackage.token}>
          <span className="screenshot-eyebrow">Shared reminder preview</span>
          <strong>{activeReminder.title || placeholderReminderTitle}</strong>
          <span><CalendarClock size={14}/> {formatDue(activeReminder)}</span>
          <span><MapPin size={14}/> {activeReminder.location || 'No location set'}</span>
          {activeReminder.notes && <em>{activeReminder.notes}</em>}
          <small>Tap to open the embedded shared reminder file for review and editing.</small>
          <span className="screenshot-badge">Embedded shared file</span>
        </span>
      </button>}
      <section className={sharedCoverDismissed ? 'shared-live-file is-open' : 'shared-live-file'} aria-hidden={!sharedCoverDismissed}>
        <ReminderCard
          reminder={activeReminder}
          recipientMode
          forceMap
          onLocationShared={saveSharedLocationUpdate}
          sharedSummary={lastSharedSummary}
          sharedMeta={lastSharedMeta}
          onEdit={() => {
            setForm(activeReminder);
            setRecipientEditOpen(true);
            setRecipientPreviewMode(false);
          }}
          onForward={() => {}}
          previewRecipients={previewRecipients}
          showRecipients={showRecipientsInPreview}
          onToggleRecipients={() => setShowRecipientsInPreview(value => !value)}
          editMode={recipientEditOpen && !recipientPreviewMode}
          editDate={form.date}
          editTime={form.time}
          onEditDate={value => setField('date', value)}
          onEditTime={value => setField('time', value)}
          editLocation={form.location}
          onEditLocation={value => setField('location', value)}
          editText={form.title}
          onEditText={value => setField('title', value)}
          onPinLocation={(lat, lng) => pinLocation(lat, lng)}
          locationToolsOpen={previewLocationToolsOpen}
          onToggleLocationTools={() => setPreviewLocationToolsOpen(open => !open)}
          onUseMyLocation={useCurrentLocation}
          onClearLocation={clearLocation}
          locationStatus={locationStatus}
        />
      </section>
      {recipientEditOpen && <div className="recipient-edit-bottom-bar" role="group" aria-label="Shared reminder edit actions">
        <button type="button" className="secondary recipient-preview-action" onClick={() => {
          setRecipientPreviewMode(value => !value);
          setPreviewLocationToolsOpen(false);
        }}>{recipientPreviewMode ? 'Back' : 'Preview'}</button>
        <button type="button" className="primary recipient-save-action" onClick={async () => {
          await saveSharedChanges();
          setRecipientEditOpen(false);
          setRecipientPreviewMode(false);
          setPreviewLocationToolsOpen(false);
        }} disabled={!formValid}>Save</button>
      </div>}
      {sharedStatus && <p className="recipient-shared-status">{sharedStatus}</p>}
    </main>;
  }

  return <main className="app-shell">
    <section className="hero app-settings-hero">
      <div><p className="eyebrow hero-platforms"><Smartphone size={16}/> <span className="platform-label">Android · iOS · Web</span></p><h1 className="brand-title"><span className="brand-sir">SIR</span><span className="brand-words">smart interactive reminder</span></h1></div>
      <div className="app-settings-wrap"><button type="button" className={`app-settings-button ${appSettingsOpen ? 'open' : ''}`} aria-label={appSettingsOpen ? 'Close app settings' : 'Open app settings'} onClick={() => setAppSettingsOpen(open => !open)}><Settings2 size={18}/></button>{appSettingsOpen && <div className="app-settings-menu" role="menu" aria-label="App settings">
        <div className="settings-menu-head"><strong>Menu</strong><button type="button" className="settings-menu-close" aria-label="Close menu" onClick={() => setAppSettingsOpen(false)}><X size={16}/></button></div>
        <div className="settings-menu-group display-mode-group"><span>Display mode</span>
          <div className="mode-toggle-box" role="group" aria-label="Display mode">
            <button type="button" className={`mode-option compact-mode-option ${displayMode === 'compact' ? 'selected' : ''}`} aria-pressed={displayMode === 'compact'} onClick={() => setDisplayMode('compact')}><strong>Compact</strong><small>Preview only</small></button>
            <button type="button" className={`mode-option standard-mode-option ${displayMode === 'standard' ? 'selected' : ''}`} aria-pressed={displayMode === 'standard'} onClick={() => setDisplayMode('standard')}><strong>Standard</strong><small>Create + Preview</small></button>
          </div>
        </div>
        <div className="settings-menu-group"><span>Account & support</span>
          <button type="button" role="menuitem" className="settings-card privacy-card" onClick={() => { setSettingsPopup('privacy'); setAppSettingsOpen(false); }}><span className="settings-card-icon"><ShieldCheck size={18}/></span><span><strong>Privacy &amp; Data</strong><small>Data use and protection</small></span></button>
          <button type="button" role="menuitem" className="settings-card support-card" onClick={() => { setSettingsPopup('support'); setAppSettingsOpen(false); }}><span className="settings-card-icon"><MessageCircle size={18}/></span><span><strong>Help &amp; Support</strong><small>Send a help request</small></span></button>
        </div>
        <div className="settings-menu-group">
          <button type="button" role="menuitem" className="settings-card premium-card" onClick={() => { setSettingsPopup('premium'); setAppSettingsOpen(false); }}><span className="settings-card-icon"><Heart size={18}/></span><span><strong>Give Us a Like</strong><small>Support this app</small></span></button>
        </div>
      </div>}</div>
    </section>
    <React.Suspense fallback={null}>
      {settingsPopup === 'privacy' && <PrivacyStatementPopup onClose={() => setSettingsPopup(null)} />}
      {settingsPopup === 'support' && <ContactSupportPopup onClose={() => setSettingsPopup(null)} />}
      {settingsPopup === 'premium' && <PremiumMembershipPopup onClose={() => setSettingsPopup(null)} />}
    </React.Suspense>
    <section className={`workspace-grid ${compactMode ? 'compact-display-mode' : `standard-display-mode stacked-steps step-front-${stepFront} ${reviewTabsReady ? 'review-tabs-ready' : ''}`}`}>
      {!compactMode && !reviewTabsReady && <div className="steps-folder-tabs" role="tablist" aria-label="Reminder steps">
        <button type="button" role="tab" className={`steps-folder-tab tab-1 ${stepFront === 1 ? 'active' : ''}`} aria-selected={stepFront === 1} onClick={() => { setStepFront(1); }}><b>Step 1</b><small>Create</small></button>
        <button type="button" role="tab" className={`steps-folder-tab tab-2 ${stepFront === 2 ? 'active' : ''}`} aria-selected={stepFront === 2} onClick={() => { setStepFront(2); }}><b>Step 2</b><small>Preview</small></button>
        <button type="button" role="tab" className={`steps-folder-tab tab-3 ${stepFront === 3 ? 'active' : ''}`} aria-selected={stepFront === 3} onClick={() => { setStepFront(3); setSendOpen(true); }}><b>Step 3</b><small>Send</small></button>
      </div>}
      {!compactMode && reviewTabsReady && <div className="preview-send-review-tabs" role="tablist" aria-label="Preview and send review tabs">
        <button type="button" role="tab" className={`review-switch-tab ${stepFront === 2 ? 'active' : ''}`} aria-selected={stepFront === 2} onClick={() => setStepFront(2)}><b>Preview</b><small>Review reminder</small></button>
        <button type="button" role="tab" className={`review-switch-tab ${stepFront === 3 ? 'active' : ''}`} aria-selected={stepFront === 3} onClick={() => { setStepFront(3); setSendOpen(true); }}><b>Send</b><small>Review recipient</small></button>
      </div>}
      {!compactMode && <form className="panel composer step-card step-card-1" onSubmit={e => { e.preventDefault(); sendReminderFromComposer(); }}>
        <div className="composer-title-row"><h2><Bell size={20}/> Create a reminder</h2><button type="button" className={`mic-button ${listening ? 'listening' : ''}`} style={listening ? { '--mic-bg': '#dcfce7', '--mic-fg': '#16a34a' } : undefined} onClick={startVoiceFill} aria-label="Speak to fill reminder"><Mic size={18}/></button></div>
        <div className={`voice-capture-box ${listening ? 'listening' : ''} ${voiceTranscript ? 'has-transcript' : ''}`} role="status" aria-live="polite">
          <span className="voice-star-wrap"><Sparkles size={15}/></span>
          <span className="voice-box-text">{listening ? (voiceTranscript || 'Listening…') : (voiceTranscript || 'Create a reminder by choosing a time, location, and recipient.')}</span>
        </div>
        <Field label="Reminder" error={validation.title}><input ref={el => fieldRefs.current[0] = el} value={form.title} placeholder={placeholderReminderTitle} onKeyDown={e => advance(e, 0)} onChange={e => setField('title', e.target.value)} /></Field>
        <div className="two core-time"><Field label="Date" error={validation.due}><input ref={el => fieldRefs.current[1] = el} type="date" value={form.date} onKeyDown={e => advance(e, 1)} onChange={e => setField('date', e.target.value)} /></Field><Field label="Time" error={validation.due}><input ref={el => fieldRefs.current[2] = el} type="time" value={form.time} onKeyDown={e => advance(e, 2)} onChange={e => setField('time', e.target.value)} /></Field></div>
        <Field label="Location"><div className={`location-input-with-mic ${addressMicVisible ? 'has-mic' : ''} ${locationListening ? 'listening' : ''}`}><input ref={el => fieldRefs.current[3] = el} value={form.location} onKeyDown={e => advance(e, 3)} onChange={e => setField('location', e.target.value)} placeholder="Search address, venue, landmark, or paste link" />{addressMicVisible && <button type="button" className={`address-mic-button ${locationListening ? 'listening' : ''}`} style={locationListening ? { '--address-mic-bg': '#dcfce7', '--address-mic-fg': '#16a34a' } : undefined} onClick={startLocationVoiceFill} aria-label="Speak address"><Mic size={16}/></button>}</div></Field>
        <button className="progressive-toggle location-toggle" type="button" onClick={() => setLocationToolsOpen(!locationToolsOpen)}><MapPin size={16}/> {locationToolsOpen ? 'Hide location tools' : 'Location tools'}</button>
        {locationToolsOpen && <div className="location-tools">
          <div className="location-actions action-first">
            <button type="button" onClick={() => { setAddressMicVisible(true); fieldRefs.current[3]?.focus(); }}><Mic size={15}/> Add address</button>
            <button type="button" onClick={() => setMapOpen(true)}><MapPin size={15}/> Drop pin</button>
            <button type="button" onClick={useCurrentLocation}><LocateFixed size={15}/> Use my location</button>
            <button type="button" onClick={clearLocation}>Clear location</button>
          </div>
          {locationStatus && <p className="location-status">{locationStatus}</p>}
          {mapOpen && <section className="map-card action-map" aria-label="Map view"><LocationMap pin={form.locationPin} onSelect={(lat, lng) => pinLocation(lat, lng)} /><p className="map-help"><MapPin size={14}/> Tap the map to drop a pin. Use my location for GPS, or clear location to reset.</p></section>}
        </div>}
        {sharedPackage && <div className="shared-edit-banner">
          <div><strong>Shared file mode</strong><span>{sharedStatus || 'Schedule/location edits are tracked collaboratively.'}</span></div>
          <button type="button" className="secondary" onClick={saveSharedChanges}>Save shared changes</button>
        </div>}
        {!sharedPackage && sharedStatus && <p className="location-status">{sharedStatus}</p>}
      
        <button className="progressive-toggle" type="button" onClick={() => setAdvancedOpen(!advancedOpen)}><ChevronDown size={16}/> {advancedOpen ? 'Hide more options' : 'More options'}</button>
        {advancedOpen && <div className="advanced-fields minimal-more">
          <Field label="Urgency"><select ref={el => fieldRefs.current[5] = el} value={form.urgency} onKeyDown={e => advance(e, 5)} onChange={e => setField('urgency', e.target.value)}>{Object.entries(urgencyLevels).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
          <div className="self-check-inline">
          </div>

        </div>}
        <button className="primary full composer-recipient-cta" type="submit" disabled={!formValid}><Send size={16}/> Send to whom?</button>
      </form>}
      <section className="preview-stack step-card step-card-2">
        <div className="stack-shadow s1"/><div className="stack-shadow s2"/>
        {previewReminders.length > 1 && <div className="preview-stack-nav" aria-label="Preview reminder navigation">
          <button type="button" className="ghost nav-arrow" aria-label="Previous reminder" onClick={showPreviousPreviewCard}><ChevronLeft size={15}/></button>
          <span>{currentPreviewIndex + 1} of {previewReminders.length}</span>
          <button type="button" className="ghost nav-arrow" aria-label="Next reminder" onClick={showNextPreviewCard}><ChevronRight size={15}/></button>
        </div>}
        <div key={previewMotionKey} className={`preview-card-motion ${previewMotionKey > 0 ? 'slide-up' : ''}`}>
          <ReminderCard reminder={previewReminder} compactMode={compactMode} forceMap={compactMode} onCompactVoice={startPreviewVoiceFill} compactVoiceListening={listening && previewVoiceTargetIndex === currentPreviewIndex} compactVoiceTranscript={previewVoiceTargetIndex === currentPreviewIndex ? voiceTranscript : ''} onPinLocation={(lat, lng) => pinLocation(lat, lng)} onEdit={() => { if (compactMode) { setPreviewEditOpen(open => { const entering = !open; setForm(prev => { const base = { ...previewReminder }; if (entering && (!base.title || base.title.trim() === placeholderReminderTitle)) base.title = ''; return base; }); return entering; }); } else { setStepFront(1); } }} onForward={() => { setSendOpen(true); setSendCollapsed(false); setStepFront(3); }} onDelete={previewReminder.id === BACKGROUND_BLANK_REMINDER_ID ? undefined : deletePreviewCard} previewRecipients={previewRecipients} showRecipients={showRecipientsInPreview} onToggleRecipients={() => setShowRecipientsInPreview(value => !value)} previewTimezone={previewTimezone} onPreviewTimezoneChange={setPreviewTimezone} editMode={previewEditOpen} editDate={form.date} editTime={form.time} onEditDate={value => setField('date', value)} onEditTime={value => setField('time', value)} locationToolsOpen={previewLocationToolsOpen} onToggleLocationTools={() => setPreviewLocationToolsOpen(open => !open)} onUseMyLocation={useCurrentLocation} onClearLocation={clearLocation} locationStatus={locationStatus} editText={form.title} onEditText={value => setField('title', value)} />
        </div>
      </section>
      {!compactMode && <div className="step-card step-card-3 send-step-card">
        <RecipientPanel reminder={activeReminder} onClose={() => { setSendOpen(false); setStepFront(2); }} onPreview={() => setStepFront(2)} onRecipientsChange={setPreviewRecipients} onValidRecipientsChange={setReviewTabsReady} showRecipientsInPreview={showRecipientsInPreview} onShowRecipientsChange={setShowRecipientsInPreview} initialRecipientText={voiceRecipientText} />
      </div>}
    </section>
    {compactMode && sendOpen && <div className={`send-modal-backdrop ${sendCollapsed ? 'collapsed-preview-mode' : ''}`} role="dialog" aria-modal="true" aria-label={sendCollapsed ? 'Collapsed send options' : 'Send options'} onClick={() => { if (!sendCollapsed) { setSendOpen(false); setSendCollapsed(false); } }}>
      <div className={`send-modal-shell ${sendCollapsed ? 'collapsed-preview-shell' : ''}`} onClick={e => e.stopPropagation()}>
        <RecipientPanel reminder={activeReminder} collapsed={sendCollapsed} onClose={() => { setSendOpen(false); setSendCollapsed(false); }} onPreview={() => setSendCollapsed(value => !value)} onRecipientsChange={setPreviewRecipients} showRecipientsInPreview={showRecipientsInPreview} onShowRecipientsChange={setShowRecipientsInPreview} initialRecipientText={voiceRecipientText} />
      </div>
    </div>}
  </main>;
}

export default function AppWithSelfRepair() {
  return <AppErrorBoundary><App /></AppErrorBoundary>;
}
