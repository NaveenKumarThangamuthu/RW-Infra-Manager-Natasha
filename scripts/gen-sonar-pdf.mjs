#!/usr/bin/env node
// Render the Sonar production report to PDF via Playwright.
// Usage: node scripts/gen-sonar-pdf.mjs <source-html> <output-pdf>
// Default: prints branch-production.html of today's report bundle.

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const today = new Date().toISOString().slice(0, 10);
const DEFAULT_SRC = path.resolve(process.cwd(), `public/sonar-reports/${today}/branch-production.html`);
const DEFAULT_OUT = path.resolve(process.cwd(), `public/sonar-reports/${today}/production-report.pdf`);

const srcPath = process.argv[2] || DEFAULT_SRC;
const outPath = process.argv[3] || DEFAULT_OUT;

if (!fs.existsSync(srcPath)) {
  console.error('Source HTML not found:', srcPath);
  process.exit(1);
}

const fileUrl = 'file://' + srcPath;
console.log('Rendering', fileUrl, '→', outPath);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 30_000 });
// Give web fonts a moment to swap in.
await page.waitForTimeout(500);
await page.emulateMedia({ media: 'print' });

await page.pdf({
  path: outPath,
  format: 'A4',
  landscape: true,
  printBackground: true,
  margin: { top: '10mm', right: '8mm', bottom: '12mm', left: '8mm' },
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;padding:0 12mm;font-size:8px;color:#64748b;font-family:sans-serif;display:flex;justify-content:space-between">
    <span>Natasha Infra Manager · Sonar Code Quality Report</span>
    <span>Prepared ${today}</span>
  </div>`,
  footerTemplate: `<div style="width:100%;padding:0 12mm;font-size:8px;color:#94a3b8;font-family:sans-serif;display:flex;justify-content:space-between">
    <span>Confidential · Prepared by Natasha Infra Manager</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`,
});

await browser.close();
const size = fs.statSync(outPath).size;
console.log('PDF written:', outPath, `(${(size/1024).toFixed(1)} KB)`);
