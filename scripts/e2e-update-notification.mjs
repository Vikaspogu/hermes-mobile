#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = join(process.cwd(), 'dashboard', 'dist', 'mobile');
const indexPath = join(root, 'index.html');
const screenshotPath = '/tmp/hermes-pwa-update-notification.png';

if (!existsSync(indexPath)) {
  throw new Error('dashboard/dist/mobile/index.html missing; run npm run build first');
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function safeFilePath(pathname) {
  const raw = pathname === '/' ? '/index.html' : pathname;
  const decoded = decodeURIComponent(raw).replace(/^\/+/, '');
  const normalized = normalize(decoded);
  if (normalized.startsWith('..')) return indexPath;
  return join(root, normalized);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const file = safeFilePath(url.pathname);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    const body = await readFile(indexPath);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('server did not bind TCP port');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.addInitScript(() => {
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;

    constructor() {
      setTimeout(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.(new Event('open'));
        this.onmessage?.({
          data: `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { type: 'gateway.ready', payload: {} },
          })}\n`,
        });
      }, 0);
    }

    send() {}

    close() {
      this.readyState = FakeWebSocket.CLOSED;
      this.onclose?.(new CloseEvent('close'));
    }
  }

  window.WebSocket = FakeWebSocket;
});

await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  if (path === '/api/status') {
    return json({ auth_required: false, gateway_state: 'running', gateway_running: true, version: 'test' });
  }
  if (path === '/api/auth/ws-ticket') {
    return json({ ticket: 'test-ticket', ttl_seconds: 30 });
  }
  if (path === '/api/plugins/hermes-pwa/update/check') {
    return json({
      ok: true,
      current: '0.1.0',
      latest: '0.1.1',
      source: 'npm',
      update_available: true,
      can_apply: false,
      manual_required: true,
      install_method: 'unknown',
      checked_at: '2026-06-25T15:49:51Z',
      instructions: [
        {
          id: 'web-ui-force-reinstall',
          label: 'Hermes Web UI / Git URL',
          steps: ['Open Hermes Web UI → Plugins', 'Enable Force reinstall', 'Enable after install'],
        },
        {
          id: 'npx-force-reinstall',
          label: 'npm / npx',
          command: 'npx -y hermes-pwa@latest install --force',
          steps: ['Run the command on the Hermes host', 'Restart Hermes Dashboard/gateway if needed'],
        },
      ],
    });
  }
  if (path === '/api/profiles') return json({ profiles: [] });
  if (path === '/api/profiles/active') return json({ active: 'default', current: 'default' });
  if (path === '/api/profiles/sessions') return json({ sessions: [] });
  if (path === '/api/plugins/hermes-pwa/actions/pending') return json({ items: [] });
  if (path === '/api/plugins/hermes-pwa/push/status') {
    return json({ available: false, enabled: false, reason: 'test', subscriptions: [] });
  }
  if (path === '/api/system/stats') return json({});
  if (path === '/api/plugins/kanban/boards') return json({ boards: [] });

  return json({ items: [], sessions: [], profiles: [], boards: [], jobs: [] });
});

try {
  await page.goto(`http://127.0.0.1:${address.port}/index.html`, { waitUntil: 'domcontentloaded' });
  await page.getByText('Update available').waitFor({ timeout: 10_000 });
  await page.getByText('Hermes PWA 0.1.0 → 0.1.1').waitFor();
  await page.getByText('Manual update required').waitFor();
  await page.getByText('npx -y hermes-pwa@latest install --force').first().waitFor();
  await mkdir('/tmp', { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`E2E update notification passed. Screenshot: ${screenshotPath}`);
} finally {
  await browser.close();
  server.close();
}
