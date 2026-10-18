import { chromium, devices } from 'playwright';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const url = process.env.PREVIEW_URL || 'http://localhost:3011/?preview';
const screenshotPath = process.env.SCREENSHOT_PATH || resolve('dashboard/dist/mobile/preview-qa.png');

const localChromium = resolve('.playwright-browsers/chromium-1223/chrome-linux64/chrome');

async function smoke(page, drawerPath) {
  const menu = page.locator('[aria-label="Open menu"]');
  await menu.waitFor({ state: 'visible', timeout: 5000 });

  await menu.click();
  await page.locator('[aria-label="Close menu"]').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const panel = document.querySelector('.hm-drawer__panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
  });
  await page.waitForTimeout(200);
  if (drawerPath) await page.screenshot({ path: drawerPath, fullPage: false });
  await page.locator('[aria-label="Close menu"]').click();

  await page.locator('nav[aria-label="Main navigation"] button:has-text("System")').click();
  await page.locator('text=Gateway').first().waitFor({ state: 'visible' });

  await page.locator('nav[aria-label="Main navigation"] button:has-text("History")').click();
  await page.waitForTimeout(300);

  await page.locator('nav[aria-label="Main navigation"] button:has-text("Chat")').click();
  await page.waitForTimeout(300);
}

async function capture(browser, colorScheme, path) {
  const context = await browser.newContext({
    ...devices['iPhone 14'],
    reducedMotion: 'reduce',
    colorScheme,
  });
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('response', (resp) => {
    if (resp.status() >= 400) errors.push(`network ${resp.status()}: ${resp.url()}`);
  });
  page.on('requestfailed', (req) => {
    errors.push(`requestfailed: ${req.url()} ${req.failure()?.errorText ?? ''}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const drawerPath = path.replace(/\.png$/i, '-drawer.png');
  await smoke(page, drawerPath);
  await page.screenshot({ path, fullPage: false });
  await context.close();
  return errors;
}

async function run() {
  const launchOptions = existsSync(localChromium)
    ? { executablePath: localChromium }
    : {};

  const browser = await chromium.launch({ headless: true, ...launchOptions });

  const lightErrors = await capture(browser, 'light', screenshotPath);
  const darkPath = screenshotPath.replace(/\.png$/i, '-dark.png');
  const darkErrors = await capture(browser, 'dark', darkPath);

  await browser.close();

  const errors = [...lightErrors, ...darkErrors];
  if (errors.length > 0) {
    console.warn('QA warnings/errors:');
    errors.forEach((e) => console.warn('  -', e));
  } else {
    console.log('No console/page errors detected.');
  }
  console.log(`Light screenshot saved to ${screenshotPath}`);
  console.log(`Dark screenshot saved to ${darkPath}`);
  process.exit(errors.length > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
