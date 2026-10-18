import { chromium } from 'playwright';
import { loadE2EEnv } from './lib/env.mjs';

const APP_READY_SELECTORS = [
  '[data-testid="app-header"]',
  'text=Home',
  'text=Start a conversation with Hermes',
  'text=Hermes-Agent PWA',
];

function redactUrl(url) {
  const parsed = new URL(url);
  parsed.username = '';
  parsed.password = '';
  parsed.search = parsed.search ? '?…' : '';
  return `${parsed.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
}

async function waitForAny(page, selectors, timeout = 15000) {
  const errors = [];
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().waitFor({ timeout: Math.max(1000, Math.floor(timeout / selectors.length)) });
      return selector;
    } catch (error) {
      errors.push(`${selector}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  throw new Error(`None of the ready selectors appeared. ${errors.join(' | ')}`);
}

async function maybeOpenLoginPage(page, env) {
  const bodyText = await page.locator('body').innerText({ timeout: 2000 }).catch(() => '');
  if (!/unauthenticated|Unauthorized|no_cookie/i.test(bodyText)) return false;
  const loginUrl = new URL('/login', env.baseUrl);
  loginUrl.searchParams.set('next', new URL(env.baseUrl).pathname);
  await page.goto(loginUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
  return true;
}

async function maybeLogin(page, env) {
  const openedLogin = await maybeOpenLoginPage(page, env);
  const passwordInput = page.locator('input[type="password"], input[name="password"]').first();
  if (!(await passwordInput.isVisible({ timeout: 2500 }).catch(() => false))) {
    return openedLogin ? 'login-not-required-after-login-page' : 'already-authenticated';
  }

  if (!env.username || !env.password) {
    throw new Error('Login form is visible but username/password env vars are missing');
  }

  const usernameInput = page.locator('input[name="username"], input[type="text"], input[type="email"]').first();
  if (await usernameInput.isVisible({ timeout: 1000 }).catch(() => false)) {
    await usernameInput.fill(env.username);
  }
  await passwordInput.fill(env.password);

  const loginResponse = page.waitForResponse((response) => response.url().includes('/auth/password-login'), { timeout: 15000 }).catch(() => undefined);
  const submit = page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")').first();
  if (await submit.isVisible({ timeout: 1000 }).catch(() => false)) {
    await submit.click();
  } else {
    await passwordInput.press('Enter');
  }
  const response = await loginResponse;
  if (!response?.ok()) {
    throw new Error(`Login request failed${response ? ` with HTTP ${response.status()}` : ''}`);
  }
  await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  return 'login-submitted';
}

export async function runAuthSmoke({ keepBrowser = false } = {}) {
  const env = loadE2EEnv({ requireAuth: false });
  console.log(`E2E env: baseUrl=${env.diagnostics.baseUrl} username=${env.diagnostics.username} password=${env.diagnostics.password} profile=${env.diagnostics.profile}`);
  console.log(`E2E target: ${redactUrl(env.baseUrl)}`);

  const browser = await chromium.launch({ headless: env.headless });
  const contextOptions = {};
  if (env.username && env.password) {
    contextOptions.httpCredentials = { username: env.username, password: env.password };
  }
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  try {
    await page.goto(env.baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const loginState = await maybeLogin(page, env);
    consoleErrors.length = 0;
    await waitForAny(page, APP_READY_SELECTORS, 20000);
    const fatalErrors = consoleErrors.filter((line) => !/React DevTools/i.test(line));
    if (fatalErrors.length) {
      throw new Error(`Browser console errors: ${fatalErrors.slice(0, 3).join(' | ')}`);
    }
    console.log(`E2E auth smoke passed (${loginState}).`);
    return { browser, context, page, env };
  } catch (error) {
    await page.screenshot({ path: '/tmp/hermes-pwa-auth-smoke-failed.png', fullPage: true }).catch(() => undefined);
    throw error;
  } finally {
    if (!keepBrowser) await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAuthSmoke()
    .then(() => undefined)
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
