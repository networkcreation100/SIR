import { chromium } from 'playwright';
const url = 'https://wires-desired-mike-floral.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();
const form = page.locator('form.composer');
let bodyText = await page.locator('body').innerText();
for (const forbidden of ['swipe left save / right remove', 'Detail-row gestures', 'Due:', 'Tomorrow 9 AM', 'Smart fill', 'Milestone']) {
  if (bodyText.includes(forbidden)) throw new Error(`Forbidden/redundant UI text still visible: ${forbidden}`);
}
await page.getByText('Use the buttons below to edit or send this reminder.').waitFor();
await page.locator('.reminder-card h2', { hasText: 'Meeting at the bar' }).waitFor();

await form.getByRole('button', { name: 'Send reminder' }).click();
await page.getByLabel('Send Reminder panel').waitFor();
const recipientBox = page.getByRole('textbox', { name: 'Recipients' });
if ((await recipientBox.inputValue()) !== '') throw new Error('Email recipient box should start empty');
if ((await recipientBox.getAttribute('placeholder')) !== 'alex.rivera@example.com, morgan.chen@example.com') throw new Error('Email placeholder should show multiple example emails');
if (!(await page.getByRole('button', { name: /Package \+ send/i }).isDisabled())) throw new Error('Package + send should be disabled before recipient selection');
await page.getByRole('button', { name: /alex\.rivera@example\.com/i }).click();
await page.getByRole('button', { name: /morgan\.chen@example\.com/i }).click();
let value = await recipientBox.inputValue();
if (value !== 'alex.rivera@example.com, morgan.chen@example.com') throw new Error(`Email multi-select failed: ${value}`);
await page.getByText('2 recipients ready.').waitFor();

await page.getByRole('button', { name: /^Text/i }).click();
if ((await recipientBox.inputValue()) !== '') throw new Error('Text recipient box should start empty after switching modes');
if ((await recipientBox.getAttribute('placeholder')) !== '+1 555 010 1200, +1 555 010 3488') throw new Error('Text placeholder should show multiple example phone numbers');
await page.getByRole('button', { name: /\+1 555 010 1200/i }).click();
await page.getByRole('button', { name: /\+1 555 010 8842/i }).click();
value = await recipientBox.inputValue();
if (value !== '+1 555 010 1200, +1 555 010 8842') throw new Error(`Phone multi-select failed: ${value}`);
await page.getByText('2 recipients ready.').waitFor();
await recipientBox.fill('+1 555 010 1200, +1 555 010 3488');
await page.getByText('2 recipients ready.').waitFor();
if (await page.getByRole('button', { name: /Package \+ send/i }).isDisabled()) throw new Error('Package + send should enable for valid multiple phones');

await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });
await page.getByRole('button', { name: /Minimize/i }).click();
await page.getByRole('button', { name: /Expand/i }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;
bodyText = await page.locator('body').innerText();
for (const forbidden of ['swipe left save / right remove', 'Detail-row gestures', 'Due:']) {
  if (bodyText.includes(forbidden)) throw new Error(`Forbidden UI text appeared later: ${forbidden}`);
}
await page.screenshot({ path: 'scripts/copilot-recipient-clean-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['redundant due/gesture copy removed','visible buttons are primary action path','bottom send opens panel','email/text placeholder defaults','direct contact email/phone selection','multiple recipients','download still works'], consoleErrors, pageErrors, screenshot: 'scripts/copilot-recipient-clean-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
