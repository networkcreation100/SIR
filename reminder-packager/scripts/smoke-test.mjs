import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const consoleErrors = [];
const pageErrors = [];
page.on('console', msg => {
  if (['error', 'warning'].includes(msg.type())) consoleErrors.push(`${msg.type()}: ${msg.text()}`);
});
page.on('pageerror', err => pageErrors.push(err.message));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.getByRole('heading', { name: 'SIR smart interactive reminder' }).waitFor();
await page.getByRole('heading', { name: 'Sender composer' }).waitFor();
await page.getByRole('heading', { name: 'Complete Project Proposal' }).waitFor();
await page.getByRole('button', { name: /Send current/i }).click();
await page.getByRole('heading', { name: 'Select recipients' }).waitFor();
await page.getByRole('button', { name: /Cancel/i }).click();
if (await page.getByRole('heading', { name: 'Recipient experience' }).count()) throw new Error('Recipient experience panel should be removed');
await page.screenshot({ path: 'scripts/smoke-screenshot.png', fullPage: true });

console.log(JSON.stringify({
  title: await page.title(),
  consoleErrors,
  pageErrors,
  screenshot: 'scripts/smoke-screenshot.png'
}, null, 2));

if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
await browser.close();
