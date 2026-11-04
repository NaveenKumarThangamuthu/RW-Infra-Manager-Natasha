import { chromium } from '@playwright/test';

const URL = 'https://phpbb-waves-tunnel-continuity.trycloudflare.com';
const shots = [
  { path: '/', name: 'index-production' },
  { path: '/all-branches.html', name: 'portfolio' },
  { path: '/repo-rw-erp-service--feat-env-prod.html', name: 'repo-erp' },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// Log console errors
const consoleMessages = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMessages.push(`${m.type()}: ${m.text()}`); });

for (const s of shots) {
  await page.goto(URL + s.path, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: `/tmp/sonar-shots/${s.name}.png`, fullPage: true });

  // Extract measurements + potential bugs
  const audit = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const hasHScroll = doc.scrollWidth > doc.clientWidth;
    // measure key element widths
    const measure = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) };
    };
    // find things overflowing viewport
    const overflow = [];
    document.querySelectorAll('table, .panel, .kpi, .report-header, .exec-summary').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) overflow.push({ tag: el.tagName, cls: el.className.slice(0,60), right: Math.round(r.right), w: Math.round(r.width) });
    });
    // detect wrapping issues in the main table by counting rows with height > 60px
    const bigRows = [];
    document.querySelectorAll('table tbody tr').forEach((tr, i) => {
      const h = tr.getBoundingClientRect().height;
      if (h > 60) bigRows.push({ i, h: Math.round(h) });
    });
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      scrollWidth: doc.scrollWidth,
      hasHScroll,
      report_header: measure('.report-header'),
      wrap: measure('.wrap'),
      kpi_row: measure('.kpi-row'),
      table: measure('.panel table'),
      overflow,
      bigRows: bigRows.slice(0, 5),
    };
  });
  console.log('===', s.name, '===');
  console.log(JSON.stringify(audit, null, 2));
}

console.log('=== Console messages ===');
console.log(consoleMessages.slice(0, 20).join('\n'));
await browser.close();
