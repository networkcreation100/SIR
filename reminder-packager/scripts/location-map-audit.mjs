import { chromium } from 'playwright';
const url = 'https://students-habitat-manga-lands.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  geolocation: { latitude: 21.3069, longitude: -157.8583 },
  permissions: ['geolocation']
});
await context.grantPermissions(['geolocation'], { origin: url });
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();

const form = page.locator('form.composer');
if (await form.locator('textarea').count()) throw new Error('Note field should be hidden before More options opens');

const inputs = form.locator('input');
await inputs.nth(0).fill('Location Pin Test');
await inputs.nth(1).fill('2026-07-27');
await inputs.nth(2).fill('09:00');
await inputs.nth(3).fill('Conference Room B');
await page.locator('.line-item strong', { hasText: 'Conference Room B' }).waitFor();

await page.getByRole('button', { name: /Map view/i }).click();
await page.getByLabel('Map view').waitFor();
await page.getByText('Map ready').waitFor();
await page.getByRole('button', { name: /Use current location/i }).click();
await page.getByText(/Pinned at 21\.30690, -157\.85830/).waitFor({ timeout: 15000 });
await page.locator('form input').nth(3).inputValue().then(value => {
  if (value !== 'Pinned current location') throw new Error(`Expected pinned location input, got ${value}`);
});
await page.locator('.line-item strong', { hasText: 'Pinned current location' }).waitFor();
await page.locator('.map-card iframe').waitFor();

await page.getByRole('button', { name: /More options/i }).click();
await form.locator('textarea').fill('Bring a photo ID.');
await page.locator('.line-item strong', { hasText: 'Bring a photo ID.' }).waitFor();
await form.locator('input').nth(4).fill('Check-in');
await page.locator('select').selectOption('urgent');
await form.locator('input').nth(5).fill('12');
await form.locator('input').nth(6).fill('4');
await page.getByRole('button', { name: /Hide options/i }).click();
if (await form.locator('textarea').count()) throw new Error('Note field should hide again after Hide options');

await page.getByRole('button', { name: 'Save reminder' }).click();
await page.getByRole('button', { name: /Minimize/i }).click();
await page.getByRole('button', { name: /Expand/i }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
await page.getByRole('button', { name: /^Send Reminder$/i }).first().click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByRole('button', { name: /Text/i }).click();
await page.getByRole('button', { name: /Taylor Brooks/i }).click();
await page.getByText('+1 555 010 8842').waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();

await page.screenshot({ path: 'scripts/location-map-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['note hidden in More options','location always visible','map view','use current location geolocation pin','preview sync','save/download/send buttons'], consoleErrors, pageErrors, screenshot: 'scripts/location-map-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
