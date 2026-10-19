/* eslint-env node */
import { chromium } from 'playwright';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..');

// Tab screens are one tap away; the rest open through the More sheet.
const tabs = [
  { key: 'home', tab: 'Chats' },
  { key: 'approvals', tab: 'Inbox', fuzzy: true },
  { key: 'kanban', tab: 'Work' },
];
const moreItems = [
  { key: 'profiles', row: 'Profiles' },
  { key: 'agents', row: 'Agents' },
  { key: 'cron', row: 'Schedules' },
  { key: 'artifacts', row: 'Artifacts' },
  { key: 'command', row: 'System' },
  { key: 'settings', row: 'Settings' },
];

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3010/?preview');
  await page.waitForSelector('[data-testid="app-header"]', { timeout: 10000 });

  async function shot(key) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(outDir, `m-${key}.png`), fullPage: true });
    console.log('Captured', key);
  }

  for (const { key, tab, fuzzy } of tabs) {
    await page.getByRole('button', { name: tab, exact: !fuzzy }).click();
    await shot(key);
  }

  // More sheet itself
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.waitForSelector('.hm-more-sheet__panel', { state: 'visible', timeout: 5000 });
  await shot('more');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.hm-more-sheet__panel', { state: 'hidden', timeout: 5000 });

  for (const { key, row } of moreItems) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.waitForSelector('.hm-more-sheet__panel', { state: 'visible', timeout: 5000 });
    await page.locator('.hm-more-row', { hasText: row }).first().click();
    await shot(key);
  }

  // Chat: open the first thread from Chats home
  await page.getByRole('button', { name: 'Chats', exact: true }).click();
  await page.waitForSelector('[data-testid="thread-row"]', { timeout: 5000 });
  await page.locator('[data-testid="thread-row"]').first().click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(outDir, 'm-chat.png'), fullPage: true });
  console.log('Captured chat');

  await browser.close();
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
