import { chromium } from 'playwright';
const url = 'https://supervisors-expression-column-celebrities.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
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
const form = page.locator('form.composer');
let bodyText = await page.locator('body').innerText();
for (const forbidden of ['Tomorrow 9 AM', 'Smart fill', 'Milestone']) {
  if (bodyText.includes(forbidden)) throw new Error(`${forbidden} should not be visible`);
}
if (await form.locator('textarea').count()) throw new Error('Note field should be hidden before More options');
if (await page.locator('.line-item', { hasText: 'Notes' }).count()) throw new Error('Blank default note should not render in preview');
if (await page.locator('.line-item', { hasText: 'Milestone' }).count()) throw new Error('Milestone should not render in preview');

await page.getByRole('button', { name: /More options/i }).click();
const note = form.locator('textarea');
await note.waitFor();
if ((await note.inputValue()) !== '') throw new Error('Note textarea should start blank');
bodyText = await page.locator('body').innerText();
for (const forbidden of ['Tomorrow 9 AM', 'Smart fill', 'Milestone']) {
  if (bodyText.includes(forbidden)) throw new Error(`${forbidden} should be removed from More options`);
}
await note.fill('User-written note only.');
await page.locator('.line-item strong', { hasText: 'User-written note only.' }).waitFor();
await page.getByRole('button', { name: /Hide options/i }).click();

await page.getByRole('button', { name: /Use current location/i }).click();
await page.getByText(/Pinned: 100 Current Location Ave/).waitFor({ timeout: 15000 });
await page.locator('form input').nth(3).inputValue().then(value => {
  if (!value.includes('100 Current Location Ave')) throw new Error('Address did not auto-fill location field');
});
await page.getByRole('button', { name: 'Save reminder' }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
await page.getByRole('button', { name: /^Send Reminder$/i }).first().click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();

await page.screenshot({ path: 'scripts/no-autofill-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['note hidden and blank','auto-fill buttons removed','milestone removed','location/address still works','save/download/send still work'], consoleErrors, pageErrors, screenshot: 'scripts/no-autofill-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
