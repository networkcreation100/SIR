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
if ((await page.title()) !== 'SIR smart interactive reminder') throw new Error(`Wrong page title: ${await page.title()}`);
const forbidden = ['5 of 5', 'quietly', 'quiet', 'Web call', 'web call', 'Progressive send panel', 'Due:', 'swipe left save / right remove', 'Detail-row gestures', 'Tomorrow 9 AM', 'Smart fill', 'Stakeholder review', 'Milestone', 'Compact Reminder Packager', 'Download package'];
let bodyText = await page.locator('body').innerText();
for (const term of forbidden) {
  if (bodyText.includes(term)) throw new Error(`Forbidden Copilot term visible: ${term}`);
}
await page.getByText('Use the buttons below to edit or send this reminder.').waitFor();
const form = page.locator('form.composer');
const reminderInput = form.locator('input').nth(0);
if ((await reminderInput.inputValue()) !== '') throw new Error('Reminder input should start empty');
if ((await reminderInput.getAttribute('placeholder')) !== 'Meeting at the bar') throw new Error('Reminder placeholder mismatch');
await page.locator('.reminder-card h2', { hasText: 'Meeting at the bar' }).waitFor();
await form.locator('input').nth(0).fill('call the girls');
await page.locator('.reminder-card h2', { hasText: 'call the girls' }).waitFor();

await page.getByRole('button', { name: /Use current location/i }).click();
await page.getByText(/Pinned: 100 Current Location Ave/).waitFor({ timeout: 15000 });
const locationValue = await form.locator('input').nth(3).inputValue();
if (!locationValue.includes('100 Current Location Ave')) throw new Error(`Location did not auto-fill: ${locationValue}`);
await page.locator('.line-item', { hasText: '100 Current Location Ave' }).waitFor();
await page.locator('.leaflet-map').waitFor();

await form.getByRole('button', { name: 'Send reminder' }).click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByText('Delivery panel').waitFor();
const recipientBox = page.getByRole('textbox', { name: 'Recipients' });
if ((await recipientBox.inputValue()) !== '') throw new Error('Email recipient box should start empty');
if ((await recipientBox.getAttribute('placeholder')) !== 'alex.rivera@example.com, morgan.chen@example.com') throw new Error('Email placeholder mismatch');
if (!(await page.getByRole('button', { name: /Package \+ send/i }).isDisabled())) throw new Error('Package + send should be disabled before recipients');
await page.getByRole('button', { name: /alex\.rivera@example\.com/i }).click();
await page.getByRole('button', { name: /morgan\.chen@example\.com/i }).click();
await page.getByText('2 recipients ready.').waitFor();
await page.getByRole('button', { name: /^Text/i }).click();
if ((await recipientBox.inputValue()) !== '') throw new Error('Text recipient box should start empty after mode switch');
if ((await recipientBox.getAttribute('placeholder')) !== '+1 555 010 1200, +1 555 010 3488') throw new Error('SMS placeholder mismatch');
await page.getByRole('button', { name: /\+1 555 010 1200/i }).click();
await page.getByRole('button', { name: /\+1 555 010 3488/i }).click();
await page.getByText('2 recipients ready.').waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });

const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
bodyText = await page.locator('body').innerText();
for (const term of forbidden) {
  if (bodyText.includes(term)) throw new Error(`Forbidden Copilot term visible after interactions: ${term}`);
}
await page.screenshot({ path: 'scripts/final-website-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, title: await page.title(), covered: ['fresh public URL renders','no blocked-script blank page','no Copilot forbidden terms','preview updates live','current location auto-fills address','map opens','send panel works','email and phone contact chips work','multiple recipients work','download works'], consoleErrors, pageErrors, screenshot: 'scripts/final-website-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
