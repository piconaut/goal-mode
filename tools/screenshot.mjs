// Drive the built UI in headless Chromium and capture screenshots (dev aid).
// Usage: node tools/screenshot.mjs <outDir> [light|dark|3270] [--all]
//   default: briefing, console, Change Desk, mobile; --all adds every tab and Change Desk area.
import { chromium } from 'playwright-core';

const out = process.argv[2] ?? '.';
const theme = ['light', 'dark', '3270'].includes(process.argv[3]) ? process.argv[3] : 'light';
const all = process.argv.includes('--all');
// Pre-installed Chromium: default launch first, then the fixed path (no version in it).
const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, colorScheme: theme === 'light' ? 'light' : 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript((t) => {
  try {
    localStorage.setItem('goalmode.theme', JSON.stringify(t));
  } catch {
    // Storage blocked: the OS colour scheme applies.
  }
}, theme);
await page.goto('http://localhost:4173/');
await page.waitForSelector('.modal');
await page.screenshot({ path: `${out}/1-briefing.png` });
await page.getByText('Start day (06:00)').click();
await page.getByRole('button', { name: '8×' }).click();
await page.getByRole('button', { name: 'Skip tutorial' }).click({ timeout: 2000 }).catch(() => {});
await page.waitForTimeout(8000);
await page.screenshot({ path: `${out}/2-console.png`, fullPage: true });
await page.getByRole('button', { name: 'Change Desk' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-changes.png`, fullPage: true });
if (all) {
  for (const area of ['LPARs & hardware', 'Systems, CF & I/O', 'Batch & operations', 'Projects']) {
    await page.getByRole('tab', { name: area }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/desk-${area.replace(/\W+/g, '-').toLowerCase()}.png`, fullPage: true });
  }
  for (const tab of ['Monitor', 'RMF Reports', 'Finance', 'Analytics', 'Codex', 'Inbox']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}`) }).first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/tab-${tab.toLowerCase().replace(/\W+/g, '-')}.png`, fullPage: true });
  }
}
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('button', { name: 'Ops Console' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/4-mobile.png` });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('errors:', errors.length ? errors : 'none', 'mobile horizontal overflow:', overflow);
await browser.close();
