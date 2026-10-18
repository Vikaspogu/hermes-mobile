import { runAuthSmoke } from './auth-smoke.mjs';

const PRIVATE_CACHE_KEYS = [
  'hermes-pwa.activeSession.v1',
  'hermes-pwa.activeSession.v3',
  'hermes-pwa.activeSession.v4:default',
  'hermes-pwa.activeSession.v4:dev',
  'hermes-pwa.pinnedSessions.v1',
  'hermes-kanban-board',
  'hermes-mobile-screen',
];

async function runLogoutPrivacy() {
  const session = await runAuthSmoke({ keepBrowser: true });
  const { browser, page, env } = session;
  try {
    await page.evaluate((keys) => {
      for (const key of keys) window.localStorage.setItem(key, 'seeded-private-cache');
      window.localStorage.setItem('unrelated-setting', 'keep');
    }, PRIVATE_CACHE_KEYS);

    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.getByRole('button', { name: /Open menu/i }).click();
    await page.getByRole('button', { name: /^Settings$/i }).click();
    const logout = page.getByRole('button', { name: /Log out/i });
    await logout.waitFor({ timeout: 20000 });
    await logout.click();

    await page.waitForFunction(
      (keys) => keys.every((key) => window.localStorage.getItem(key) === null),
      PRIVATE_CACHE_KEYS,
      { timeout: 15000 },
    );

    const unrelated = await page.evaluate(() => window.localStorage.getItem('unrelated-setting'));
    if (unrelated !== 'keep') {
      throw new Error('Logout privacy check removed unrelated localStorage data');
    }
    console.log('E2E logout privacy passed. Private cache keys removed; unrelated key preserved.');
  } catch (error) {
    await page.screenshot({ path: '/tmp/hermes-pwa-logout-privacy-failed.png', fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

runLogoutPrivacy().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
