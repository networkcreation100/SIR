import { chromium } from 'playwright';
const url = 'https://www-carriers-notebook-corrected.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();
const form = page.locator('form.composer');
await form.getByRole('button', { name: 'Send reminder' }).click();
await page.getByLabel('Send Reminder panel').waitFor();
const recipientBox = page.getByRole('textbox', { name: 'Recipients' });
if ((await recipientBox.inputValue()) !== '') throw new Error('Email recipient box should start empty');
if ((await recipientBox.getAttribute('placeholder')) !== 'alex.rivera@example.com, morgan.chen@example.com') throw new Error('Email placeholder should show multiple example emails');
if (!(await page.getByRole('button', { name: /Package \+ send/i }).isDisabled())) throw new Error('Package + send should be disabled until recipients are selected or entered');

await page.getByRole('button', { name: /alex\.rivera@example\.com/i }).click();
await page.getByRole('button', { name: /morgan\.chen@example\.com/i }).click();
let value = await recipientBox.inputValue();
if (value !== 'alex.rivera@example.com, morgan.chen@example.com') throw new Error(`Email contact multi-select failed: ${value}`);
await page.getByText('2 recipients ready.').waitFor();
await recipientBox.fill('alex.rivera@example.com, taylor.brooks@example.com');
await page.getByText('2 recipients ready.').waitFor();

await page.getByRole('button', { name: /^Text/i }).click();
if ((await recipientBox.inputValue()) !== '') throw new Error('Text recipient box should start empty after switching modes');
if ((await recipientBox.getAttribute('placeholder')) !== '+1 555 010 1200, +1 555 010 3488') throw new Error('Text placeholder should show multiple example phone numbers');
await page.getByRole('button', { name: /\+1 555 010 1200/i }).click();
await page.getByRole('button', { name: /\+1 555 010 8842/i }).click();
value = await recipientBox.inputValue();
if (value !== '+1 555 010 1200, +1 555 010 8842') throw new Error(`Phone contact multi-select failed: ${value}`);
await page.getByText('2 recipients ready.').waitFor();
await recipientBox.fill('+1 555 010 1200, +1 555 010 3488');
await page.getByText('2 recipients ready.').waitFor();
if (await page.getByRole('button', { name: /Package \+ send/i }).isDisabled()) throw new Error('Package + send should enable for valid multiple phones');

await page.getByRole('button', { name: /morgan\.chen@example\.com/i }).click();
await page.getByText('3 recipients ready.').waitFor();
value = await recipientBox.inputValue();
if (!value.includes('morgan.chen@example.com')) throw new Error('Email chip did not append directly from contact popup');

await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });
await page.screenshot({ path: 'scripts/recipient-multi-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['email placeholder default content','text placeholder default content','direct email contact selection','direct phone contact selection','multiple comma-separated emails','multiple comma-separated phones','mode-specific recipient fields'], consoleErrors, pageErrors, screenshot: 'scripts/recipient-multi-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
