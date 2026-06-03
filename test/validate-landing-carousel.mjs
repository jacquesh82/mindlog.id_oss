/**
 * Validation script: landing carousel fitLandingColumns
 * Tests overflow and scale at 1280x800 and 1100x620
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '../public'); // reuse existing writable dir
const SCREENSHOTS = join(OUT, 'validation-screenshots');

try { mkdirSync(SCREENSHOTS, { recursive: true }); } catch {}

const MEASURE_JS = `(() => {
  const cols=[...document.querySelectorAll('#deck .col')];
  const i=cols.findIndex(c=>c.classList.contains('active'));
  const c=cols[i]; const inner=c?.firstElementChild;
  return JSON.stringify({active:i, colClientH:c?.clientHeight, colScrollH:c?.scrollHeight, overflow:(c?.scrollHeight>c?.clientHeight+1), innerTransform:inner?inner.style.transform:null, label:document.getElementById('deck-title')?.textContent});
})()`;

const GLOBAL_JS = `JSON.stringify({bodyOverflowY:getComputedStyle(document.body).overflowY, docScrollH:document.documentElement.scrollHeight, docClientH:document.documentElement.clientHeight})`;

const VIEWPORTS = [
  { name: 'desktop-1280x800', width: 1280, height: 800 },
  { name: 'compact-1100x620', width: 1100, height: 620 },
];

const SLIDE_COUNT = 6;

async function validateViewport(browser, vp) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Viewport: ${vp.name} (${vp.width}x${vp.height})`);
  console.log('='.repeat(60));

  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  await page.goto('http://localhost:8787/', { waitUntil: 'networkidle', timeout: 15000 });

  // Wait for app to be ready
  await page.waitForSelector('#app[data-view="landing"]', { timeout: 10000 });
  // Extra wait for JS fitLandingColumns to execute
  await page.waitForTimeout(2500);

  // Global overflow check
  const global = JSON.parse(await page.evaluate(GLOBAL_JS));
  console.log(`\nGlobal: bodyOverflowY=${global.bodyOverflowY}, docScrollH=${global.docScrollH}, docClientH=${global.docClientH}, pageOverflow=${global.docScrollH > global.docClientH + 1}`);

  const results = [];

  for (let slide = 0; slide < SLIDE_COUNT; slide++) {
    // Wait for animation to settle
    if (slide > 0) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(700);
    }

    // Measure
    const raw = await page.evaluate(MEASURE_JS);
    const data = JSON.parse(raw);
    results.push(data);

    const overflow = data.overflow ? 'OVERFLOW!' : 'ok';
    const scale = data.innerTransform || '(none)';
    console.log(`  Slide ${slide + 1}: [${overflow}] label="${data.label}" scrollH=${data.colScrollH} clientH=${data.colClientH} scale="${scale}"`);

    // Screenshot
    const fname = `${vp.name}-slide-${slide + 1}.png`;
    await page.screenshot({ path: join(SCREENSHOTS, fname), fullPage: false });
    console.log(`    -> screenshot: ${fname}`);
  }

  await context.close();

  return { viewport: vp.name, global, results };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const allResults = [];
  for (const vp of VIEWPORTS) {
    const r = await validateViewport(browser, vp);
    allResults.push(r);
  }

  await browser.close();

  // Summary
  console.log('\n\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  for (const r of allResults) {
    console.log(`\n[${r.viewport}]`);
    console.log(`  Page overflow: ${r.global.docScrollH > r.global.docClientH + 1 ? 'YES (BAD)' : 'none (good)'}`);
    console.log(`  bodyOverflowY: ${r.global.bodyOverflowY}`);
    for (const s of r.results) {
      const status = s.overflow ? '!! OVERFLOW' : 'ok';
      const scale = s.innerTransform || '(no transform)';
      console.log(`  Slide ${s.active + 1} "${s.label}": ${status} | scrollH=${s.colScrollH} clientH=${s.colClientH} | ${scale}`);
    }
  }

  // Write JSON results
  const jsonPath = join(SCREENSHOTS, 'results.json');
  writeFileSync(jsonPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults saved to: ${jsonPath}`);
  console.log(`Screenshots in: ${SCREENSHOTS}`);
})();
