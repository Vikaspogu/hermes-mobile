import { runAuthSmoke } from './auth-smoke.mjs';
import { withHash } from './lib/env.mjs';

const MARKER = `PWA_E2E_OK_${Date.now().toString(36)}`;

async function openChat(page, baseUrl) {
  await page.goto(withHash(baseUrl, 'chat'), { waitUntil: 'domcontentloaded', timeout: 30000 });
  const input = page.getByLabel('Message input');
  if (await input.isVisible({ timeout: 5000 }).catch(() => false)) return;
  const newChat = page.getByText('New chat', { exact: true }).first();
  if (await newChat.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newChat.click();
  }
  await input.waitFor({ timeout: 15000 });
}

async function sendPrompt(page) {
  const input = page.getByLabel('Message input');
  await input.waitFor({ timeout: 15000 });
  const prompt = `Reply with exactly: ${MARKER}`;
  await input.fill(prompt);
  await page.getByRole('button', { name: /Send message/i }).click();
}

async function waitForMarker(page) {
  await page.getByText(MARKER, { exact: false }).waitFor({ timeout: 120000 });
  await page.getByRole('button', { name: /Send message/i }).waitFor({ timeout: 30000 });
}

async function runChatSmoke() {
  const session = await runAuthSmoke({ keepBrowser: true });
  const { browser, page, env } = session;
  try {
    await openChat(page, env.baseUrl);
    await sendPrompt(page);
    await waitForMarker(page);
    await page.screenshot({ path: '/tmp/hermes-pwa-chat-smoke.png', fullPage: true });
    console.log('E2E chat smoke passed. Screenshot: /tmp/hermes-pwa-chat-smoke.png');
  } catch (error) {
    await page.screenshot({ path: '/tmp/hermes-pwa-chat-smoke-failed.png', fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    await browser.close();
  }
}

runChatSmoke().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
