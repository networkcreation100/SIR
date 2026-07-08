export const urgencyLevels = {
  low: { label: 'Low', color: '#3b82f6', minutes: 10080 },
  normal: { label: 'Medium', color: '#f59e0b', minutes: 1440 },
  urgent: { label: 'High', color: '#ef4444', minutes: 180 }
};

export function createReminderId() {
  return `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSharedLocations(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: item.id ? String(item.id) : undefined,
      recipient: item.recipient ? String(item.recipient) : undefined,
      color: /^#[0-9a-f]{6}$/i.test(String(item.color || '')) ? String(item.color) : undefined,
      name: String(item.name || item.label || item.recipient || item.user || 'Shared user').trim() || 'Shared user',
      lat: Number(item.lat ?? item.latitude),
      lng: Number(item.lng ?? item.longitude),
      heading: Number.isFinite(Number(item.heading)) ? Number(item.heading) : null,
      accuracy: Number.isFinite(Number(item.accuracy)) ? Number(item.accuracy) : null,
      updatedAt: item.updatedAt || item.at || new Date().toISOString()
    }))
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
    .slice(0, 12);
}

export function normalizeReminder(input) {
  const now = new Date();
  const id = input.id || createReminderId();
  return {
    id,
    schema: 'networkcreation.compact-reminder.v1',
    title: input.title?.trim() || 'Untitled Reminder',
    date: input.date || now.toISOString().slice(0, 10),
    time: input.time || `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    location: input.location?.trim() || 'No location set',
    locationPin: input.locationPin || null,
    sharedLocations: normalizeSharedLocations(input.sharedLocations),
    milestone: input.milestone?.trim() || '',
    urgency: input.urgency || 'low',
    notes: input.notes?.trim() || '',
    sender: input.sender?.trim() || 'Sender',
    recipients: input.recipients || [],
    permission: input.permission || 'shared-edit',
    snoozeMinutes: Number(input.snoozeMinutes || 15),
    autoDismissMinutes: Number(input.autoDismissMinutes || 5),
    version: Number(input.version || 1),
    createdAt: input.createdAt || now.toISOString(),
    sentAt: input.sentAt || null,
    updatedAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  };
}

export function getDueDate(reminder) {
  return new Date(`${reminder.date}T${reminder.time || '00:00'}`);
}

export function getStatus(reminder, now = new Date()) {
  const due = getDueDate(reminder);
  const deltaMinutes = Math.round((due.getTime() - now.getTime()) / 60000);
  if (deltaMinutes < 0) return { label: 'OVERDUE', tone: 'danger', deltaMinutes };
  if (deltaMinutes <= 60) return { label: 'DUE SOON', tone: 'danger', deltaMinutes };
  if (deltaMinutes <= urgencyLevels[reminder.urgency]?.minutes) return { label: 'UPCOMING', tone: 'warning', deltaMinutes };
  return { label: 'SCHEDULED', tone: 'safe', deltaMinutes };
}

export function formatDue(reminder) {
  const due = getDueDate(reminder);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(due);
}

export function encodeReminder(reminder) {
  const json = JSON.stringify(normalizeReminder(reminder));
  return btoa(unescape(encodeURIComponent(json)));
}

export function decodeReminder(encoded) {
  return JSON.parse(decodeURIComponent(escape(atob(encoded))));
}

export function buildStandaloneViewer(reminder) {
  const safe = JSON.stringify(normalizeReminder(reminder)).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${escapeHtml(reminder.title)} Reminder</title>
<style>
:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff7ed;color:#111827}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(135deg,#fff7ed,#eff6ff)}.card{width:min(440px,100%);border:2px solid var(--accent,#f97316);border-radius:24px;background:rgba(255,255,255,.92);box-shadow:0 24px 60px rgba(15,23,42,.20);overflow:hidden}.bar{height:10px;background:var(--accent,#f97316)}main{padding:24px}h1{font-size:24px;margin:0 0 12px}.note{line-height:1.6;color:#374151}.due{margin:20px 0;padding:12px;border-radius:14px;background:#fff7ed;color:#dc2626;font-weight:700}.grid{display:grid;gap:10px}.item{padding:12px;border:1px solid #e5e7eb;border-radius:14px;background:#fff}.actions{display:flex;gap:10px;margin-top:20px}.actions button{flex:1;border:0;border-radius:12px;padding:12px;font-weight:700}.primary{background:#f97316;color:white}.secondary{background:#e5e7eb;color:#111827}@media(prefers-color-scheme:dark){:root{background:#111827;color:#f9fafb}body{background:linear-gradient(135deg,#111827,#1f2937)}.card{background:rgba(17,24,39,.94)}.note{color:#d1d5db}.item{background:#1f2937;border-color:#374151}.secondary{background:#374151;color:#f9fafb}}
</style>
</head>
<body>
<article class="card" role="dialog" aria-label="Reminder popup">
<div class="bar"></div><main><h1 id="title"></h1><p class="note" id="notes"></p><div class="due" id="due"></div><section class="grid" id="details"></section><div class="actions"><button class="secondary" onclick="snooze()">Snooze</button><button class="primary" onclick="dismiss()">Seen</button></div></main>
</article>
<script>
const reminder=${safe};
const status=()=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(reminder.date+'T'+reminder.time));
document.documentElement.style.setProperty('--accent', {low:'#22c55e',normal:'#f59e0b',urgent:'#ef4444'}[reminder.urgency] || '#f97316');
document.getElementById('title').textContent=reminder.title;
document.getElementById('notes').textContent=reminder.notes;
document.getElementById('due').textContent=status();
document.getElementById('details').innerHTML=['Location: '+reminder.location,(reminder.locationPin ? 'Pinned map: '+reminder.locationPin.lat.toFixed(5)+', '+reminder.locationPin.lng.toFixed(5) : null),'Sender: '+reminder.sender,'Timezone: '+reminder.timezone].filter(Boolean).map(x=>'<div class="item">'+x.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div>').join('');
function snooze(){document.querySelector('.due').textContent='Snoozed for '+reminder.snoozeMinutes+' minutes';setTimeout(()=>alert('Reminder reappeared'),500)}
function dismiss(){document.body.innerHTML='<main style="text-align:center"><h1>Reminder seen</h1><p>This popup was dismissed after confirmation.</p></main>'}
setTimeout(()=>{document.querySelector('.card').style.transform='scale(.96)';document.querySelector('.card').style.opacity='.85'}, reminder.autoDismissMinutes*60000);
</script>
</body>
</html>`;
}

export function makeAttachmentFiles(reminder) {
  const normalized = normalizeReminder(reminder);
  const base = normalized.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'reminder';
  return [
    new File([JSON.stringify(normalized, null, 2)], `${base}.reminder.json`, { type: 'application/json' }),
    new File([buildStandaloneViewer(normalized)], `${base}-viewer.html`, { type: 'text/html' })
  ];
}

export function buildReminderSnapshotSvg(reminder) {
  const normalized = normalizeReminder(reminder);
  const title = escapeHtml(normalized.title);
  const due = escapeHtml(formatDue(normalized));
  const location = escapeHtml(normalized.location || 'No location set');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="1180" viewBox="0 0 820 1180">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fff7ed"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="20" stdDeviation="22" flood-color="#0f172a" flood-opacity="0.16"/></filter>
  </defs>
  <rect width="820" height="1180" rx="44" fill="url(#bg)"/>
  <rect x="15" y="15" width="790" height="1150" rx="38" fill="none" stroke="#22c55e" stroke-width="6"/>
  <g filter="url(#shadow)">
    <rect x="70" y="62" width="680" height="1028" rx="34" fill="#ffffff"/>
  </g>
  <circle cx="690" cy="96" r="43" fill="#ffffff" stroke="#e5e7eb" stroke-width="3"/>
  <path d="M672 104 L690 86 L708 104" fill="none" stroke="#4b5563" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="105" y="156" font-family="Arial, sans-serif" font-size="52" font-weight="800" fill="#111827">${title}</text>
  <rect x="105" y="208" width="610" height="112" rx="27" fill="#ecfdf5" stroke="#60a5fa" stroke-width="5"/>
  <circle cx="145" cy="264" r="16" fill="#16a34a" opacity="0.18"/>
  <path d="M135 255 h20 M140 244 v22 M150 244 v22 M136 253 h18 v22 h-18z" stroke="#16a34a" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="178" y="283" font-family="Arial, sans-serif" font-size="32" font-weight="800" fill="#15803d">${due}</text>
  <circle cx="112" cy="388" r="13" fill="#f8fafc" stroke="#94a3b8" stroke-width="4"/>
  <circle cx="112" cy="388" r="4" fill="#94a3b8"/>
  <text x="145" y="401" font-family="Arial, sans-serif" font-size="25" font-weight="800" fill="#64748b">${location}</text>
  <g transform="translate(105 455)">
    <rect width="610" height="335" rx="24" fill="#f8fafc" stroke="#e5e7eb" stroke-width="3"/>
    <rect x="20" y="22" width="570" height="205" rx="20" fill="#eef2ff"/>
    <path d="M20 144 C120 94 178 206 294 154 C398 108 470 132 590 70" stroke="#fb7185" stroke-width="24" opacity=".65" fill="none"/>
    <path d="M24 206 C150 186 255 252 370 206 C458 170 510 186 590 168" stroke="#fde68a" stroke-width="36" fill="none"/>
    <path d="M52 38 L590 224 M118 22 L208 226 M272 22 L360 228 M438 22 L544 228" stroke="#cbd5e1" stroke-width="8"/>
    <circle cx="305" cy="130" r="22" fill="#fb923c" stroke="#f97316" stroke-width="8" opacity=".9"/>
    <rect x="518" y="92" width="54" height="100" rx="10" fill="#ffffff" stroke="#d1d5db" stroke-width="2"/>
    <text x="545" y="132" text-anchor="middle" font-family="Arial" font-size="36" font-weight="800" fill="#111827">+</text>
    <text x="545" y="178" text-anchor="middle" font-family="Arial" font-size="36" font-weight="800" fill="#111827">−</text>
    <text x="85" y="266" font-family="Arial" font-size="24" font-weight="800" fill="#64748b">Address located on map · nearby places</text>
    <rect x="25" y="286" width="560" height="58" rx="29" fill="#fff7ed" stroke="#fed7aa" stroke-width="3"/>
    <text x="305" y="324" text-anchor="middle" font-family="Arial" font-size="23" font-weight="800" fill="#ea580c">Enable location</text>
  </g>
  <rect x="105" y="858" width="610" height="86" rx="24" fill="#f3f4f6"/>
  <text x="410" y="914" text-anchor="middle" font-family="Arial" font-size="27" font-weight="800" fill="#111827">Edit schedule &amp; location</text>
  <text x="105" y="1010" font-family="Arial" font-size="25" font-weight="700" fill="#94a3b8">Interactive shared reminder — tap this preview</text>
  <text x="105" y="1044" font-family="Arial" font-size="25" font-weight="700" fill="#94a3b8">to review and edit the embedded file.</text>
</svg>`;
}

export function buildReminderMessageBody(reminder) {
  const normalized = normalizeReminder(reminder);
  const shareUrl = reminder?.shareUrl || normalized.shareUrl;
  return [
    `Reminder: ${normalized.title}`,
    `Scheduled: ${formatDue(normalized)}`,
    `Location: ${normalized.location || 'No location set'}`,
    normalized.notes ? `Instruction: ${normalized.notes}` : '',
    shareUrl ? `Open interactive reminder: ${shareUrl}` : 'Open the interactive reminder link from the sender.'
  ].filter(Boolean).join('\n');
}

export function createMailto(reminder, recipients = []) {
  const encoded = encodeURIComponent(buildReminderMessageBody(reminder));
  const to = recipients.map(value => value.trim()).filter(Boolean).join(',');
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(`Reminder: ${reminder.title}`)}&body=${encoded}`;
}

export function createSmsLink(reminder, recipients = []) {
  const body = encodeURIComponent(buildReminderMessageBody(reminder));
  const to = recipients.join(',');
  return `sms:${encodeURIComponent(to)}?body=${body}`;
}

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function isCircleGesture(points) {
  if (!points || points.length < 18) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const closeDistance = Math.hypot(first.x - last.x, first.y - last.y);
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (width < 40 || height < 40) return false;
  const ratio = width / height;
  return closeDistance < Math.max(width, height) * 0.35 && ratio > 0.55 && ratio < 1.65;
}
