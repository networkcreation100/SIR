import { chromium } from 'playwright';
const url = 'https://regime-selection-lightweight-thing.trycloudflare.com';
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
const location = inputs.nth(3);
const milestone = inputs.nth(4);
const notes = page.locator('textarea');
const urgency = page.locator('select');

// Inline validation + disabled save
await title.fill('A');
await page.getByText('Add at least 3 characters.').waitFor();
await page.locator('button[type="submit"]').waitFor({ state: 'visible' });
const disabledAfterInvalid = await page.locator('button[type="submit"]').isDisabled();
if (!disabledAfterInvalid) throw new Error('Save button should disable on invalid title');

// Auto-advance with Enter
await title.fill('Board Meeting Reminder');
await page.getByRole('button', { name: /Apply prediction/i }).click();
await title.press('Enter');
const activeType = await page.evaluate(() => document.activeElement?.getAttribute('type'));
if (activeType !== 'date') throw new Error('Enter did not auto-advance from title to date');

// Live preview mirrors every composer field
await date.fill('2026-07-04');
await page.locator('.line-item strong', { hasText: '2026-07-04' }).waitFor();
await time.fill('09:45');
await page.locator('.line-item strong', { hasText: '09:45' }).waitFor();
await location.fill('Conference Room A');
await page.locator('.line-item strong', { hasText: 'Conference Room A' }).waitFor();
await milestone.fill('Final approval');
await page.locator('.line-item strong', { hasText: 'Final approval' }).waitFor();
await urgency.selectOption('low');
await notes.fill('Bring signed packet and ID.');
await page.locator('.line-item strong', { hasText: 'Bring signed packet and ID.' }).waitFor();
await page.getByLabel('Smart assistant').waitFor();
await page.getByText(/confidence/i).first().waitFor();
await page.getByText('Gesture guide').waitFor();

// Smart defaults buttons
await page.getByRole('button', { name: 'Tomorrow 9 AM' }).click();
await page.locator('.line-item strong', { hasText: '09:00' }).waitFor();
await page.getByRole('button', { name: 'Review meeting' }).click();
await page.locator('.line-item strong', { hasText: 'Stakeholder review' }).waitFor();
await page.getByRole('button', { name: 'Urgent rules' }).click();

// Progressive disclosure + timing inputs
await page.getByRole('button', { name: /Show timing rules/i }).click();
await page.getByLabel(/Snooze minutes/i).fill('22');
await page.getByLabel(/Auto-dismiss minutes/i).fill('7');
await page.getByRole('button', { name: /Hide timing rules/i }).waitFor();

// Save and preview buttons
await page.getByRole('button', { name: 'Save shared reminder object' }).click();
await page.locator('.window-dots span', { hasText: '2 of 5' }).waitFor();
await page.getByRole('button', { name: /Minimize/i }).click();
await page.getByRole('button', { name: /Expand/i }).click();
await page.getByRole('button', { name: /Edit shared object/i }).click();

// Download button creates an attachment package
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Download the App/i }).click();
await downloadPromise;

// Send panel: side panel, modes, suggestions, validation, close/cancel
await page.getByRole('button', { name: /^Send Reminder$/i }).first().click();
await page.getByLabel('Send Reminder panel').waitFor();
await page.getByRole('button', { name: /Text/i }).click();
await page.getByRole('button', { name: /Morgan Chen/i }).click();
await page.getByText('+1 555 010 3488').waitFor();
await page.getByRole('button', { name: /Email/i }).click();
await page.getByRole('textbox', { name: 'Recipients' }).fill('bad-email');
await page.getByText(/valid email format/i).waitFor();
const packageDisabled = await page.getByRole('button', { name: /Package \+ send/i }).isDisabled();
if (!packageDisabled) throw new Error('Package + send should disable for invalid email');
await page.getByRole('button', { name: /Alex Rivera/i }).click();
await page.getByText('alex.rivera@example.com').waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });
await page.getByRole('button', { name: /^Send Reminder$/i }).first().click();
await page.getByRole('button', { name: /Close/i }).click();
await page.getByLabel('Send Reminder panel').waitFor({ state: 'detached' });

await page.screenshot({ path: 'scripts/copilot-fix-audit.png', fullPage: true });
console.log(JSON.stringify({ ok: true, url, covered: ['inline validation','auto-advance','auto-suggest recipients','smart defaults','progressive disclosure','preview buttons','download button','send panel modes','recipient validation','cancel/close controls'], consoleErrors, pageErrors, screenshot: 'scripts/copilot-fix-audit.png' }, null, 2));
if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
