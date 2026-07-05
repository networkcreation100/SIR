import { chromium } from 'playwright';
const url = 'https://ask-screenshots-personally-mods.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  acceptDownloads: true,
  geolocation: { latitude: 21.3069, longitude: -157.8583 },
  permissions: ['geolocation']
});
await context.grantPermissions(['geolocation'], { origin: url });
const page = await context.newPage();
await page.route('https://nominatim.openstreetmap.org/reverse**', async route => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ display_name: '100 Current Location Ave, Honolulu, HI 96813, United States' }) });
});
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();
let body = await page.locator('body').innerText();
for (const forbidden of ['Delivery panel', 'Package + send', 'Edit shared object', 'Send Reminder', 'Close', 'Only reminder, date, time, and location are shown first.', 'Use current location', 'Map view', 'Download package', 'Alex Rivera', 'Morgan Chen', 'Taylor Brooks', '+1 555 010']) {
  if (body.includes(forbidden)) throw new Error(`Forbidden/stale text visible initially: ${forbidden}`);
}
await page.getByText('Start with reminder, schedule, and location. Tools stay tucked away.').waitFor();
await page.getByRole('button', { name: /Location tools/i }).waitFor();
await page.locator('.reminder-card').getByRole('button', { name: 'Edit reminder details' }).waitFor();
await page.locator('.reminder-card').getByRole('button', { name: 'Send reminder' }).waitFor();
if (await page.locator('.reminder-card .line-item').count()) throw new Error('Preview still has repeated Date/Time/Location detail rows');

await page.getByRole('button', { name: /Location tools/i }).click();
await page.getByRole('button', { name: /Use current location/i }).click();
await page.getByText(/Pinned: 100 Current Location Ave/).waitFor({ timeout: 15000 });
await page.locator('.leaflet-map').waitFor();

await page.locator('form.composer').getByRole('button', { name: 'Send reminder' }).click();
await page.getByLabel('Send options panel').waitFor();
await page.getByRole('button', { name: 'Hide send options' }).waitFor();
await page.getByText('Send options', { exact: true }).waitFor();
await page.getByRole('heading', { name: 'Send reminder' }).waitFor();
body = await page.locator('body').innerText();
for (const forbidden of ['Delivery panel', 'Package + send', 'Edit shared object', 'Close', 'Alex Rivera', 'Morgan Chen', 'Taylor Brooks', 'alex.rivera@example.com', '+1 555 010']) {
  if (body.includes(forbidden)) throw new Error(`Forbidden/stale text visible after send panel: ${forbidden}`);
}
const box = page.getByRole('textbox', { name: 'Recipients' });
await box.fill('first@example.com, second@example.com');
await page.getByText('2 recipients ready.').waitFor();
await page.getByText('Email recipients from the box').waitFor();
await page.getByText('first@example.com').waitFor();
await page.getByText('second@example.com').waitFor();
await page.getByRole('button', { name: 'Create attachment & send email' }).waitFor();
if (await page.getByRole('button', { name: 'Create attachment & send email' }).isDisabled()) throw new Error('Email send action should enable for valid typed emails');
await page.getByRole('button', { name: /^Text/i }).click();
await page.getByRole('textbox', { name: 'Recipients' }).fill('+1 808 555 1212, +1 808 555 3434');
await page.getByText('Text recipients from the box').waitFor();
await page.getByText('+1 808 555 1212').waitFor();
await page.getByRole('button', { name: 'Create reminder & open text' }).waitFor();
await page.getByRole('button', { name: 'Back to composer' }).click();
await page.getByLabel('Send options panel').waitFor({ state: 'detached' });
await page.getByRole('button', { name: /More options/i }).click();
await page.getByRole('button', { name: /Download the App/i }).waitFor();
await page.screenshot({ path: 'scripts/copilot-flow-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['send panel no longer uses modal close language','recipient panel only mirrors typed values','final delivery button is explicit by channel','preview no longer repeats date/time/location rows','top action clutter removed','location tools are tucked away until requested','download moved under More options','capitalization normalized'], consoleErrors, pageErrors, screenshot: 'scripts/copilot-flow-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
