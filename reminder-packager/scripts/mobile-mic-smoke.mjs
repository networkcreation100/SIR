import { chromium, devices } from 'playwright';

const browser = await chromium.launch({ headless: true });
const results = {};

// ---------- 1) DESKTOP: app loads clean, no JS errors ----------
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  // brand title should be visible on desktop
  const brandVisible = await page.locator('.brand-title').first().isVisible();
  const platformVisible = await page.locator('.platform-label').first().isVisible();
  results.desktop = {
    brandTitleVisible: brandVisible,
    platformLabelVisible: platformVisible,
    consoleErrors,
    pageErrors,
  };
  await page.close();
}

// ---------- 2) MOBILE: brand title + platform line hidden ----------
{
  const iPhone = devices['iPhone 13'];
  const page = await browser.newPage({ ...iPhone });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(e.message));

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  const brandHidden = await page.locator('.brand-title').first().isHidden();
  const platformHidden = await page.locator('.platform-label').first().isHidden();
  // music toggle should still exist (we only hid the label, not the control)
  const musicToggleExists = await page.locator('.music-toggle').count();
  await page.screenshot({ path: 'scripts/mobile-view-after-fix.png', fullPage: true });
  results.mobile = {
    brandTitleHidden: brandHidden,
    platformLabelHidden: platformHidden,
    musicToggleExists: musicToggleExists > 0,
    consoleErrors,
    pageErrors,
  };
  await page.close();
}

console.log(JSON.stringify(results, null, 2));

const allErrors = [
  ...results.desktop.consoleErrors, ...results.desktop.pageErrors,
  ...results.mobile.consoleErrors, ...results.mobile.pageErrors,
];
const pass =
  results.desktop.brandTitleVisible === true &&
  results.desktop.platformLabelVisible === true &&
  results.mobile.brandTitleHidden === true &&
  results.mobile.platformLabelHidden === true &&
  results.mobile.musicToggleExists === true &&
  allErrors.length === 0;

console.log(pass ? '\n✅ SMOKE PASS' : '\n❌ SMOKE FAIL');
if (!pass) process.exitCode = 1;
await browser.close();
