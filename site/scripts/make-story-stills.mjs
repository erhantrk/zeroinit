// Renders the four beats of the map story (the same code the page runs) to WebP stills for the no-JS,
// reduced-motion and Save-Data fallback: 1280x720 for wide screens, 600x700 for phones.
// Needs the preview server on :4321 and a Chromium. Usage: node scripts/make-story-stills.mjs
import fs from 'node:fs';
import os from 'node:os';
import sharp from 'sharp';
import { chromium } from 'playwright';

const P = [0.2125, 0.495, 0.7125, 1]; // each beat as it looks when its caption is centred
const SETS = [
  { prefix: 'story-', w: 1280, h: 720 },
  { prefix: 'story-m', w: 600, h: 700 },
];
// Browser: CHROME_PATH if set, else the pinned Linux build where it exists, else Playwright's own Chromium.
const pinned = os.homedir() + '/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell';
const executablePath = process.env.CHROME_PATH || (fs.existsSync(pinned) ? pinned : undefined);
const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const set of SETS) {
  const page = await browser.newPage({ viewport: { width: set.w, height: set.h + 56 } }); // 56 = sticky header
  await page.goto('http://localhost:4321/?still', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__story?.ready);
  await page.addStyleTag({ content: '.story-text,.story-shade,.story-hud,.site-head,.status{display:none!important}' });
  await page.evaluate(() => scrollTo(0, document.querySelector('.story-driver').getBoundingClientRect().top + scrollY));
  await page.waitForTimeout(300);
  const box = await page.locator('.story-stage').boundingBox();
  for (const [i, p] of P.entries()) {
    await page.evaluate((pp) => window.__story.force(pp), p);
    await page.waitForTimeout(400);
    const png = await page.screenshot({ clip: { x: 0, y: box.y, width: set.w, height: set.h } });
    const out = new URL(`../public/assets/${set.prefix}${i}.webp`, import.meta.url).pathname;
    const info = await sharp(png).webp({ quality: 80, effort: 6 }).toFile(out);
    console.log(`${set.prefix}${i}.webp`, info.size, 'B');
  }
  await page.close();
}
await browser.close();
