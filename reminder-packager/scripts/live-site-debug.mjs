import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
page.on('console', msg => console.log('console', msg.type(), msg.text()));
page.on('pageerror', err => console.log('pageerror', err.message));
await page.goto('https://superagent-934909c8.base44.app/functions/sirWebsite?cb=' + Date.now(), { waitUntil: 'networkidle' });
console.log('title exists', await page.locator('#title').count(), 'preview', await page.locator('#pTitle').textContent());
for (const [input, value, preview] of [['#title','Board Meeting Reminder','#pTitle'],['#dateIn','2026-07-04','#pDate'],['#time','09:45','#pTime'],['#location','Conference Room A','#pLocation'],['#milestone','Final approval','#pMilestone'],['#notes','Bring signed packet and ID.','#pNotes']]) {
  console.log('filling', input);
  await page.fill(input, value);
  await page.waitForTimeout(300);
  console.log('preview text', preview, await page.locator(preview).textContent());
}
await page.screenshot({ path: 'scripts/live-site-debug.png', fullPage: true });
await browser.close();
