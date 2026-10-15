import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const url = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const phase = process.argv[2] ?? 'after';
await mkdir('artifacts/ux', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    await page.goto(url);
    await page.locator('.board-wrap [data-square="e1"]').waitFor();
    await page.screenshot({ path: `artifacts/ux/${phase}-${name}.png`, fullPage: true });
    console.log(`${name}: width ${await page.evaluate(() => document.documentElement.scrollWidth)}, viewport ${viewport.width}`);
    await page.close();
  }
} finally { await browser.close(); }
