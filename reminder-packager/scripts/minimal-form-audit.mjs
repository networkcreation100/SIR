import { chromium } from 'playwright';
const url = 'https://levy-nose-second-forgotten.trycloudflare.com';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(`${msg.type()}: ${msg.text()}`); });
page.on('pageerror', err => pageErrors.push(err.message));
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.getByText('Sender composer').waitFor();

const inputs = page.locator('input');
const title = inputs.nth(0);
const date = inputs.nth(1);
const time = inputs.nth(2);
const notes = page.locator('textarea');

// Minimum info only: smart card and old sections should be gone
if (await page.getByLabel('Smart assistant').count()) throw new Error('Smart assistant card should be hidden in simplified form');
if (await page.getByText('Context details').count()) throw new Error('Context details should not be visible until More options');
await page.getByText('Smart defaults run quietly').waitFor();

// Validation and auto-advance
await title.fill('A');
await page.getByText('Add at least 3 characters.').waitFor();
if (!(await page.getByRole('button', { name: 'Save reminder' }).isDisabled())) throw new Error('Save reminder should disable when title is invalid');
await title.fill('Board Meeting Reminder');
await title.press('Enter');
const activeType = await page.evaluate(() => document.activeElement?.getAttribute('type'));
if (activeType !== 'date') throw new Error('Enter did not move from Reminder to Date');

// Live preview from minimum fields
await date.fill('2026-07-04');
await page.locator('.line-item strong', { hasText: '2026-07-04' }).waitFor();
await time.fill('09:45');
await page.locator('.line-item strong', { hasText: '09:45' }).waitFor();
await notes.fill('Bring ID.');
await page.locator('.line-item strong', { hasText: 'Bring ID.' }).waitFor();

// More options drawer: context, smart fill, timing
await page.getByRole('button', { name: /More options/i }).click();
await page.getByRole('button', { name: /Smart fill/i }).waitFor();
await page.locator('input').nth(3).fill('Conference Room A');
await page.locator('.line-item strong', { hasText: 'Conference Room A' }).waitFor();
await page.locator('input').nth(4).fill('Final approval');
await page.locator('.line-item strong', { hasText: 'Final approval' }).waitFor();
await page.locator('select').selectOption('urgent');
await page.locator('input').nth(5).fill('22');
await page.locator('input').nth(6).fill('7');
await page.getByRole('button', { name: /Hide options/i }).click();
await page.getByRole('button', { name: /More options/i }).waitFor();

// Buttons
await page.getByRole('button', { name: 'Save reminder' }).click();
await page.locator('.window-dots span', { hasText: '2 of 5' }).waitFor();
await page.getByRole('button', { name: /Minimize/i }).click();
await page.getByRole('button', { name: /Expand/i }).click();
await page.getByRole('button', { name: /Edit shared object/i }).click();
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;

// Send panel still works
await page.getByRole('button', { name: /^Send Reminder$/i }).first().click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByRole('button', { name: /Text/i }).click();
await page.getByRole('button', { name: /Morgan Chen/i }).click();
await page.getByText('+1 555 010 3488').waitFor();
await page.getByRole('button', { name: /Email/i }).click();
await page.getByRole('textbox', { name: 'Recipients' }).fill('bad-email');
await page.getByText(/valid email format/i).waitFor();
if (!(await page.getByRole('button', { name: /Package \+ send/i }).isDisabled())) throw new Error('Package + send should be disabled for invalid recipient');
await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });

await page.screenshot({ path: 'scripts/minimal-form-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['minimum composer','validation','auto-advance','live preview','more options drawer','save','minimize/expand','download','send panel','recipient validation'], consoleErrors, pageErrors, screenshot: 'scripts/minimal-form-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
