// Renders the live hero shader (no text) to lossless WebP posters, so the poster matches the first shader frame.
// Needs the preview server on :4321 and the cached Chromium. Usage: node scripts/make-hero-poster.mjs
import os from 'node:os';
import sharp from 'sharp';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  executablePath: os.homedir() + '/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
for (const [name, w, h] of [['hero-poster', 1440, 900], ['hero-poster-mobile', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__heroReady === true);
  await page.addStyleTag({ content: '.hero .wrap, .hero-fx, .site-head, .status{visibility:hidden!important}' });
  await page.waitForTimeout(300);
  const box = await page.locator('.hero-map').boundingBox();
  const png = await page.screenshot({ clip: { x: 0, y: box.y, width: w, height: Math.round(box.height) } });
  const out = new URL(`../public/assets/${name}.webp`, import.meta.url).pathname;
  await sharp(png).webp({ lossless: true }).toFile(out);
  console.log(name, w, Math.round(box.height));
  await page.close();
}
await browser.close();
