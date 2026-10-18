import { chromium } from 'playwright';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const outDir = root;

const screens = [
  { key: 'home', label: 'Home' },
  { key: 'chat', label: 'Chat' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'kanban', label: 'Kanban' },
  { key: 'cron', label: 'Cron' },
  { key: 'agents', label: 'Agents' },
  { key: 'system', label: 'System' },
  { key: 'settings', label: 'Settings' },
  { key: 'skills', label: 'Skills & Tools' },
  { key: 'messaging', label: 'Messaging' },
];

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3013/?preview');
  await page.waitForSelector('[data-testid="app-header"]', { timeout: 10000 });

  for (const { key, label } of screens) {
    // Open drawer
    await page.click('button[aria-label="Open menu"]');
    await page.waitForSelector('nav.hm-drawer__panel', { state: 'visible', timeout: 5000 });
    // Click nav item by label
    const item = page.locator('.hm-drawer__nav button', { hasText: label }).first();
    await item.click();
    // Wait a moment for screen transition
    await page.waitForTimeout(400);
    const filename = join(outDir, `impl5-${key}.png`);
    await page.screenshot({ path: filename, fullPage: true });
    console.log('Captured', filename);
  }

  await browser.close();

  // Generate side-by-sides
  for (const { key } of screens) {
    const proto = join(outDir, `proto-${key}.png`);
    const impl = join(outDir, `impl5-${key}.png`);
    const side = join(outDir, `side5-${key}.png`);
    if (existsSync(proto) && existsSync(impl)) {
      try {
        execSync(`convert +append "${proto}" "${impl}" "${side}"`, { stdio: 'ignore' });
        console.log('Generated', side);
      } catch {
        console.warn('Failed to generate side-by-side for', key);
      }
    }
  }
}

capture().catch((err) => {
  console.error(err);
  process.exit(1);
});
