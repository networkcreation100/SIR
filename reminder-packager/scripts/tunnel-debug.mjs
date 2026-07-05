import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.on('console', msg => console.log('console', msg.type(), msg.text()));
await page.goto('https://lucky-pets-yell.loca.lt', { waitUntil: 'domcontentloaded' });
console.log(await page.locator('body').innerText({ timeout: 5000 }).catch(e => 'NO BODY '+e.message));
await page.screenshot({ path: 'scripts/tunnel-debug.png', fullPage: true });
await browser.close();
