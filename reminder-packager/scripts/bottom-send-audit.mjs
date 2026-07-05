import { chromium } from 'playwright';
const url = 'https://cornell-wanting-formula-phi.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();
const form = page.locator('form.composer');
const reminderInput = form.locator('input').nth(0);
if ((await reminderInput.inputValue()) !== '') throw new Error('Reminder input should be empty so placeholder is visible');
const placeholder = await reminderInput.getAttribute('placeholder');
if (placeholder !== 'Meeting at the bar') throw new Error(`Unexpected reminder placeholder: ${placeholder}`);
await page.locator('.reminder-card h2', { hasText: 'Meeting at the bar' }).waitFor();
await page.getByText('Only reminder, date, time, and location are shown first.').waitFor();
if (await form.locator('textarea').count()) throw new Error('Note should still be hidden by default');
let bodyText = await page.locator('body').innerText();
for (const forbidden of ['Tomorrow 9 AM', 'Smart fill', 'Milestone']) {
  if (bodyText.includes(forbidden)) throw new Error(`${forbidden} should stay removed`);
}

await form.locator('input').nth(1).fill('2026-07-27');
await form.locator('input').nth(2).fill('09:00');
await form.locator('input').nth(3).fill('Main office');
await page.locator('.line-item strong', { hasText: 'Main office' }).waitFor();
await form.getByRole('button', { name: 'Send reminder' }).click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByRole('button', { name: /Text/i }).click();
await page.getByRole('button', { name: /Morgan Chen/i }).click();
await page.getByText('+1 555 010 3488').waitFor();
await page.getByRole('button', { name: /Email/i }).click();
await page.getByRole('textbox', { name: 'Recipients' }).fill('bad-email');
await page.getByText(/valid email format/i).waitFor();
if (!(await page.getByRole('button', { name: /Package \+ send/i }).isDisabled())) throw new Error('Package + send should be disabled for invalid email');
await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });

const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
await page.screenshot({ path: 'scripts/bottom-send-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['placeholder reminder text','bottom button renamed Send reminder','bottom button opens Send Reminder panel','recipient validation','download still works','note/autofill/milestone cleanup remains'], consoleErrors, pageErrors, screenshot: 'scripts/bottom-send-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
