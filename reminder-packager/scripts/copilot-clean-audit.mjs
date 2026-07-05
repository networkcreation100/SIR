import { chromium } from 'playwright';
const url = 'https://diary-assessed-catherine-principles.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();
const forbidden = ['5 of 5', 'quietly', 'quiet', 'Web call', 'web call', 'Progressive send panel', 'Due:', 'swipe left save / right remove', 'Detail-row gestures', 'Tomorrow 9 AM', 'Smart fill', 'Stakeholder review', 'Milestone'];
let bodyText = await page.locator('body').innerText();
for (const term of forbidden) {
  if (bodyText.includes(term)) throw new Error(`Forbidden Copilot term visible before panel: ${term}`);
}
await page.getByText('Use the buttons below to edit or send this reminder.').waitFor();
await page.locator('.reminder-card h2', { hasText: 'Meeting at the bar' }).waitFor();
await page.locator('.line-item', { hasText: 'Video call / online link' }).waitFor();

const form = page.locator('form.composer');
await form.getByRole('button', { name: 'Send reminder' }).click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByText('Delivery panel').waitFor();
bodyText = await page.locator('body').innerText();
for (const term of forbidden) {
  if (bodyText.includes(term)) throw new Error(`Forbidden Copilot term visible after panel opened: ${term}`);
}
const recipientBox = page.getByRole('textbox', { name: 'Recipients' });
if ((await recipientBox.inputValue()) !== '') throw new Error('Recipient email field should start empty');
if ((await recipientBox.getAttribute('placeholder')) !== 'alex.rivera@example.com, morgan.chen@example.com') throw new Error('Email placeholder mismatch');
await page.getByRole('button', { name: /alex\.rivera@example\.com/i }).click();
await page.getByRole('button', { name: /morgan\.chen@example\.com/i }).click();
await page.getByText('2 recipients ready.').waitFor();
await page.getByRole('button', { name: /^Text/i }).click();
if ((await recipientBox.inputValue()) !== '') throw new Error('Recipient phone field should start empty after mode switch');
if ((await recipientBox.getAttribute('placeholder')) !== '+1 555 010 1200, +1 555 010 3488') throw new Error('SMS placeholder mismatch');
await page.getByRole('button', { name: /\+1 555 010 1200/i }).click();
await page.getByRole('button', { name: /\+1 555 010 3488/i }).click();
await page.getByText('2 recipients ready.').waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
await page.screenshot({ path: 'scripts/copilot-clean-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['no 5-of-5 text','no quietly wording','no Web call wording','no Progressive send panel label','no redundant Due colon','no visible gesture-instruction text','fresh live URL validated','recipient multi-select still works','download still works'], consoleErrors, pageErrors, screenshot: 'scripts/copilot-clean-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
