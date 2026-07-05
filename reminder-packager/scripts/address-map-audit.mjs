import { chromium } from 'playwright';
const url = 'https://races-ranks-precise-valid.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  geolocation: { latitude: 21.3069, longitude: -157.8583 },
  permissions: ['geolocation']
});
await context.grantPermissions(['geolocation'], { origin: url });
const page = await context.newPage();
let reverseCount = 0;
await page.route('https://nominatim.openstreetmap.org/reverse**', async route => {
  reverseCount += 1;
  const address = reverseCount === 1
    ? '100 Current Location Ave, Honolulu, HI 96813, United States'
    : '200 Selected Map Point, Honolulu, HI 96813, United States';
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ display_name: address })
  });
});
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();

const form = page.locator('form.composer');
const locationInput = form.locator('input').nth(3);
if (await form.locator('textarea').count()) throw new Error('Note should remain hidden until More options opens');
await locationInput.waitFor();
await page.getByRole('button', { name: /Map view/i }).click();
await page.getByLabel('Map view').waitFor();
await page.locator('.leaflet-map').waitFor();
await page.getByText(/Select any point on the map/i).waitFor();

await page.getByRole('button', { name: /Use current location/i }).click();
await page.getByText(/Pinned: 100 Current Location Ave/).waitFor({ timeout: 15000 });
if ((await locationInput.inputValue()) !== '100 Current Location Ave, Honolulu, HI 96813, United States') throw new Error('Current location did not auto-fill resolved address');
await page.locator('.line-item strong', { hasText: '100 Current Location Ave' }).waitFor();

const box = await page.locator('.leaflet-map').boundingBox();
if (!box) throw new Error('Map box not found');
await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.42);
await page.getByText(/Pinned: 200 Selected Map Point/).waitFor({ timeout: 15000 });
if ((await locationInput.inputValue()) !== '200 Selected Map Point, Honolulu, HI 96813, United States') throw new Error('Map selection did not auto-fill resolved address');
await page.locator('.line-item strong', { hasText: '200 Selected Map Point' }).waitFor();

await page.getByRole('button', { name: /More options/i }).click();
await form.locator('textarea').fill('Map-selected address saved.');
await page.locator('.line-item strong', { hasText: 'Map-selected address saved.' }).waitFor();
await page.getByRole('button', { name: 'Save reminder' }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
await page.getByRole('button', { name: /^Send Reminder$/i }).first().click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();

await page.screenshot({ path: 'scripts/address-map-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['current location reverse-geocodes into location field','map click reverse-geocodes into location field','location preview sync','note remains hidden until More options','save/download/send still work'], consoleErrors, pageErrors, screenshot: 'scripts/address-map-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
