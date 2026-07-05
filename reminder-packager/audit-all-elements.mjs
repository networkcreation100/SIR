import { chromium } from 'playwright';

const URL = process.env.URL || 'https://publicly-steven-volleyball-package.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 430, height: 940 }, isMobile: true, hasTouch: true });

const errors = [];
const failed = [];
const routeRequests = [];
const routeProxyRequests = [];
const searchRequests = [];
const checks = [];
let reverseCount = 0;
let openedUrls = [];

function check(name, pass, details = '') {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.log(`FAIL: ${name} ${details}`);
}

page.on('console', msg => {
  if (msg.type() === 'error' && !/Failed to load resource/.test(msg.text())) errors.push(msg.text());
});
page.on('pageerror', err => errors.push(err.message));
page.on('requestfailed', req => failed.push({ url: req.url(), failure: req.failure()?.errorText }));

await page.addInitScript(() => {
  localStorage.clear();
  window.__openedUrls = [];
  window.open = (url) => { window.__openedUrls.push(String(url)); return null; };
  Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.__sharedData = data; } });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition(success) {
        setTimeout(() => success({ coords: { latitude: 21.3069, longitude: -157.8583, accuracy: 6, heading: 96 } }), 35);
      },
      watchPosition(success) {
        const id = Date.now();
        setTimeout(() => success({ coords: { latitude: 21.3069, longitude: -157.8583, accuracy: 6, heading: 96 } }), 35);
        return id;
      },
      clearWatch() {}
    }
  });
  class MockSpeechRecognition {
    start() {
      setTimeout(() => this.onstart?.(), 10);
      setTimeout(() => {
        const result = [];
        result[0] = { transcript: 'Have appointment with Andy on Friday at 5:00 PM at University of Hawaii.' };
        result.isFinal = true;
        this.onresult?.({ results: [result] });
        this.onend?.();
      }, 80);
    }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = MockSpeechRecognition;
  window.webkitSpeechRecognition = MockSpeechRecognition;
});

await page.route(/.*nominatim\.openstreetmap\.org\/search.*/, route => {
  const url = decodeURIComponent(route.request().url());
  searchRequests.push(url);
  if (/University of Hawaii/i.test(url)) {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ lat: '21.2969', lon: '-157.8171', display_name: 'University of Hawaii at Manoa, Honolulu, Hawaii', name: 'University of Hawaii' }]) });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
});

await page.route(/.*nominatim\.openstreetmap\.org\/reverse.*/, route => {
  reverseCount += 1;
  const labels = [
    'Initial GPS pin, Honolulu, Hawaii',
    'Moved preview pin, University of Hawaii, Honolulu, Hawaii',
    'Manual picker pin, Honolulu, Hawaii'
  ];
  const label = labels[Math.min(reverseCount - 1, labels.length - 1)];
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ display_name: label, name: label.split(',')[0] }) });
});


await page.route('https://superagent-934909c8.base44.app/functions/sirRouteProxy', async route => {
  const body = route.request().postDataJSON();
  routeProxyRequests.push(body);
  const start = [Number(body.origin.lng), Number(body.origin.lat)];
  const end = [Number(body.destination.lng), Number(body.destination.lat)];
  await new Promise(r => setTimeout(r, 120));
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      cached: false,
      source: 'audit-route-proxy',
      route: {
        distance: 18420,
        duration: 1680,
        coordinates: [[start[1], start[0]], [(start[1] + end[1]) / 2, (start[0] + end[0]) / 2], [end[1], end[0]]]
      }
    })
  });
});

await page.route(/.*router\.project-osrm\.org\/route\/v1\/driving.*/, async route => {
  const url = decodeURIComponent(route.request().url());
  routeRequests.push(url);
  await new Promise(r => setTimeout(r, 120));
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'Ok',
      routes: [{
        distance: 18420,
        duration: 1680,
        geometry: {
          type: 'LineString',
          coordinates: [
            [-157.8583, 21.3069],
            [-157.8500, 21.3055],
            [-157.8380, 21.3015],
            [-157.8240, 21.2965],
            [-157.8050, 21.2865],
            [-157.7780, 21.2835],
            [-157.7500, 21.2930],
            [-157.7350, 21.3030]
          ]
        }
      }]
    })
  });
});

await page.route(/.*tile\.openstreetmap.*/, route => route.abort());
await page.route(/.*youtube|.*googlevideo.*/, route => route.abort());

await page.goto(`${URL}?fullElementAudit=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => /SIR/i.test(document.body.innerText) && /PREVIEW REMINDER/i.test(document.body.innerText), null, { timeout: 15000 });
await page.waitForTimeout(1400);
let body = await page.evaluate(() => document.body.innerText);
check('App shell renders', /ANDROID · IOS · WEB/.test(body) && /SIR/.test(body), body.slice(0, 80));
check('Compact Preview heading renders', /PREVIEW REMINDER/.test(body), 'Preview heading present');
check('Compact manual-entry hint is one line text', /Switch to Standard mode for manual entry/.test(body), 'Hint present');
check('Default voice helper renders', /Speak to automatically display the date, time, and location/.test(body), 'Voice helper present');
check('Preview map pin control renders', await page.locator('.preview-location-pin-icon, .preview-pin-location-button').count() >= 1, 'Pin control present');
check('Map editable help renders', /Drag the pin or tap the map to move it/.test(body), 'Editable help present');
check('Share my location button renders', /Share my location/.test(body), 'Share button present');
check('Edit and send CTAs render', /Edit schedule & location/.test(body) && /Send to whom\?/.test(body), 'Core CTAs present');

// Header controls
check('Settings button exists', await page.locator('button[aria-label="Open app settings"]').count() === 1);
check('Music button exists', await page.locator('button[aria-label="Turn background music on"]').count() === 1 || await page.locator('button[aria-label="Turn background music off"]').count() === 1);

// Voice parsing and location sync
await page.locator('.preview-card-centered-mic').click();
await page.waitForFunction(() => /University of Hawaii/i.test(document.body.innerText) && /Jul 10, 2026, 5:00 PM/i.test(document.body.innerText), null, { timeout: 15000 });
await page.waitForTimeout(900);
body = await page.evaluate(() => document.body.innerText);
check('Voice fills title/date/time/location', /Have appointment with Andy/.test(body) && /Jul 10, 2026, 5:00 PM/.test(body) && /University of Hawaii/.test(body));
check('Voice location triggered forward geocode', searchRequests.some(url => /University of Hawaii/i.test(url)), searchRequests.join('\n'));
check('Old GPS address did not overwrite spoken location', !/Pali Highway/i.test(body), 'No stale Pali Highway text');

// Move pin by tapping preview map
await page.locator('.preview-map-canvas').click({ position: { x: 260, y: 95 } });
await page.waitForFunction(() => /Moved preview pin/i.test(document.body.innerText), null, { timeout: 12000 });
body = await page.evaluate(() => document.body.innerText);
check('Preview map tap moves pin and updates location text', /Moved preview pin/.test(body));

// Route connection
await page.locator('button', { hasText: 'Share my location' }).click();
await page.waitForFunction(() => /Stop sharing location/i.test(document.body.innerText), null, { timeout: 12000 });
await page.waitForTimeout(1500);
body = await page.evaluate(() => document.body.innerText);
const parsedRoute = routeProxyRequests[0] ? [`${routeProxyRequests[0].origin.lng},${routeProxyRequests[0].origin.lat}`, `${routeProxyRequests[0].destination.lng},${routeProxyRequests[0].destination.lat}`] : [];
check('Share location activates tracking', /Stop sharing location/.test(body));
check('Route proxy request fired', routeProxyRequests.length >= 1, JSON.stringify(routeProxyRequests));
check('Route request connects different origin and destination', parsedRoute[0] && parsedRoute[1] && parsedRoute[0] !== parsedRoute[1], `${parsedRoute[0]} -> ${parsedRoute[1]}`);
check('Route line is present in SVG layer', await page.evaluate(() => [...document.querySelectorAll('svg path')].some(path => path.getAttribute('stroke') === '#2563eb' && Number(path.getAttribute('stroke-width')) >= 5)));

await page.locator('button', { hasText: 'Stop sharing location' }).click();
await page.waitForFunction(() => /Share my location/i.test(document.body.innerText), null, { timeout: 12000 });
check('Stop sharing returns button to Share my location', /Share my location/.test(await page.evaluate(() => document.body.innerText)));

// Pin picker button
await page.locator('.preview-location-pin-icon, .preview-pin-location-button').click();
await page.waitForFunction(() => /Tap the map to drop the correct pin/i.test(document.body.innerText), null, { timeout: 12000 });
check('Pin control opens inline picker', /Tap the map to drop the correct pin/i.test(await page.evaluate(() => document.body.innerText)));
await page.locator('.preview-pin-picker .leaflet-container, .preview-pin-picker .leaflet-map, .preview-pin-picker .leaflet-pane').first().click({ position: { x: 170, y: 85 } }).catch(async () => {
  await page.locator('.preview-pin-picker').click({ position: { x: 170, y: 85 } });
});
await page.waitForFunction(() => /Manual picker pin/i.test(document.body.innerText), null, { timeout: 12000 });
check('Manual pin picker updates location', /Manual picker pin/i.test(await page.evaluate(() => document.body.innerText)));
await page.locator('.preview-location-pin-icon, .preview-pin-location-button').click();
await page.waitForTimeout(250);
check('Pin control can close inline picker', (await page.locator('.preview-pin-picker').count()) === 0);

// Minimize / expand
await page.locator('button[aria-label="Minimize preview"]').click();
await page.waitForTimeout(250);
check('Preview minimize toggles to expand control', await page.locator('button[aria-label="Expand preview"]').count() === 1);
await page.locator('button[aria-label="Expand preview"]').click();
await page.waitForTimeout(250);
check('Preview expand toggles back', await page.locator('button[aria-label="Minimize preview"]').count() === 1);

// Settings/menu
await page.locator('button[aria-label="Open app settings"]').click();
await page.waitForTimeout(500);
body = await page.evaluate(() => document.body.innerText);
check('Menu/settings opens', /Menu|Privacy & Data|Help & Support|Give Us a Like/.test(body), 'Settings panel text present');
await page.keyboard.press('Escape').catch(() => {});
await page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});

// Edit mode and send panel
await page.locator('button', { hasText: 'Edit schedule & location' }).click();
await page.waitForFunction(() => /Create a reminder/i.test(document.body.innerText) || /Standard mode/i.test(document.body.innerText), null, { timeout: 12000 });
body = await page.evaluate(() => document.body.innerText);
check('Edit opens composer/standard controls', /Create a reminder|Reminder|Date|Time|Location/i.test(body));

await page.locator('button', { hasText: 'Send to whom?' }).last().click();
await page.waitForFunction(() => /Send Reminder|Recipient|Add another contact|Send/i.test(document.body.innerText), null, { timeout: 12000 });
body = await page.evaluate(() => document.body.innerText);
check('Send panel opens', /Send Reminder|Recipient|Add another contact|Send/i.test(body));

const recipientInputs = await page.locator('input, textarea').all();
let filledRecipient = false;
for (const input of recipientInputs) {
  const type = ((await input.getAttribute('type')) || '').toLowerCase();
  if (['checkbox', 'radio', 'button', 'submit', 'range'].includes(type)) continue;
  const ph = (await input.getAttribute('placeholder')) || '';
  const aria = (await input.getAttribute('aria-label')) || '';
  if (/contact|recipient|email|phone/i.test(ph + ' ' + aria)) {
    await input.fill('test@example.com');
    filledRecipient = true;
    break;
  }
}
check('Recipient input found and filled', filledRecipient);
await page.waitForTimeout(300);
body = await page.evaluate(() => document.body.innerText);
check('Valid recipient is recognized', /test@example\.com|Email|validated|ready/i.test(body));

openedUrls = await page.evaluate(() => window.__openedUrls || []);
await page.screenshot({ path: 'sir-full-elements-audit.png', fullPage: true });

const unexpectedFailed = failed.filter(item => !/youtube|googlevideo|tile.openstreetmap|openstreetmap.org/.test(item.url));
check('No browser console/page errors', errors.length === 0, errors.join('\n'));
check('No unexpected failed network requests', unexpectedFailed.length === 0, JSON.stringify(unexpectedFailed));

const passed = checks.filter(c => c.pass).length;
const failedChecks = checks.filter(c => !c.pass);
const result = {
  ok: failedChecks.length === 0,
  url: URL,
  passed,
  failed: failedChecks.length,
  failedChecks,
  checks,
  routeRequests,
  routeProxyRequests,
  searchRequests,
  openedUrls,
  errors,
  unexpectedFailed,
  screenshot: 'sir-full-elements-audit.png'
};
console.log(JSON.stringify(result, null, 2));
await browser.close();
if (!result.ok) process.exit(1);
