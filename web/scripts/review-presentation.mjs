import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.TRAPPY_TEST_URL ?? 'http://127.0.0.1:5173';
const label = process.env.TRAPPY_REVIEW_LABEL ?? 'review';
const channel = process.env.TRAPPY_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
await mkdir('artifacts/ui-review', { recursive: true });
const findings = [];
const failures = [];
try {
 for (const viewport of [{width:1440,height:1000},{width:1366,height:900},{width:1280,height:720},{width:390,height:844},{width:320,height:768}]) {
  for (const mode of ['analysis','play']) {
   const page = await browser.newPage({viewport});
   const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   await page.goto(`${base}/?mode=${mode}`);
   await page.waitForTimeout(1500);
   await page.screenshot({path:`artifacts/ui-review/${label}-${mode}-${viewport.width}.png`,fullPage:true});
   await page.screenshot({path:`artifacts/ui-review/${label}-${mode}-${viewport.width}-viewport.png`});
   const metrics = await page.evaluate(() => {
    const geometry = (selector) => { const rect = document.querySelector(selector)?.getBoundingClientRect(); return rect ? { top: rect.top, bottom: rect.bottom, height: rect.height } : null; };
    return {overflow:document.documentElement.scrollWidth>innerWidth,height:document.documentElement.scrollHeight, headings:[...document.querySelectorAll('h1,h2,h3')].filter(e=>e.getBoundingClientRect().width>0).map(e=>({tag:e.tagName,text:e.textContent,size:getComputedStyle(e).fontSize,top:e.getBoundingClientRect().top})), landmarks:[...document.querySelectorAll('nav,main,aside,header,footer')].map(e=>({tag:e.tagName,aria:e.getAttribute('aria-label')})), board: geometry('[data-testid="analysis-board"], .board-wrap'), boardTools: geometry('.board-tools'), styleControls: [...document.querySelectorAll('.workspace-panel:not([hidden]) .playing-style-controls input[type="range"]')].map(e=>({label:e.getAttribute('aria-label'),value:e.value,visible:e.getBoundingClientRect().width>0}))};
   });
   findings.push({mode,viewport,...metrics,errors});
   if (label !== 'before') {
    if (metrics.overflow) failures.push(`${mode} ${viewport.width}: horizontal page overflow`);
    if (errors.length) failures.push(`${mode} ${viewport.width}: ${errors.join('; ')}`);
    if (metrics.styleControls.length !== 12 || metrics.styleControls.some(control => !control.visible)) failures.push(`${mode} ${viewport.width}: all twelve independent style controls must remain visible`);
    if (mode === 'play' && viewport.width > 880 && metrics.boardTools?.bottom > viewport.height) failures.push(`Play ${viewport.width}: board actions below viewport (${metrics.boardTools.bottom})`);
    if (mode === 'analysis' && viewport.width <= 780 && metrics.board?.bottom > viewport.height) failures.push(`Analyze ${viewport.width}: initial board should fit in first viewport (${metrics.board?.bottom})`);
    const before = await page.locator('.workspace-panel:not([hidden]) .playing-style-controls input[type="range"]').evaluateAll(elements => elements.map(element => element.value));
    const attackLabel = `${mode === 'play' ? 'Play' : 'Analysis'} king attack`;
    const attackIndex = metrics.styleControls.findIndex(control => control.label === attackLabel);
    const aggression = page.getByRole('slider', { name: attackLabel, exact: true });
    await aggression.focus();
    const outline = await aggression.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
    if (outline.style === 'none' || outline.width === '0px') failures.push(`${mode} ${viewport.width}: keyboard control focus missing`);
    await page.keyboard.press('ArrowRight');
    const after = await page.locator('.workspace-panel:not([hidden]) .playing-style-controls input[type="range"]').evaluateAll(elements => elements.map(element => element.value));
    if (attackIndex < 0 || after[attackIndex] === before[attackIndex] || before.some((value,index) => index !== attackIndex && value !== after[index])) failures.push(`${mode} ${viewport.width}: style parameters must respond independently to keyboard input`);
   }
   await page.close();
  }
 }
 await writeFile(`artifacts/ui-review/${label}-metrics.json`,JSON.stringify(findings,null,2));
 console.log(JSON.stringify(findings,null,2));
 assert.deepEqual(failures, [], 'Presentation verification failures');
} finally {await browser.close();}
