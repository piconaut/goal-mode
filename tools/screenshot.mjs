// Drive the built UI in headless Chromium and capture screenshots (dev aid).
// Usage: node tools/screenshot.mjs <outDir>
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto('http://localhost:4173/');
await page.waitForSelector('.modal');
await page.screenshot({ path: `${out}/1-briefing.png` });
await page.getByText('Start day (06:00)').click();
await page.getByRole('button', { name: '8×' }).click();
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/2-console.png`, fullPage: true });
await page.getByRole('button', { name: 'Change Desk' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-changes.png`, fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Ops Console' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/4-mobile.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('errors:', errors.length ? errors : 'none', 'mobile horizontal overflow:', overflow);
await browser.close();
