import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(process.cwd(), 'dashboard/dist/mobile');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

function json(res, body, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function api(req, res) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  if (path === '/api/status') return json(res, { ok: true, auth_required: false, version: '0.17.0' });
  if (path === '/api/auth/providers') return json(res, { auth_required: false, providers: [] });
  if (path === '/api/auth/ws-ticket') return json(res, { ticket: 'e2e-ticket', expires_at: new Date(Date.now() + 60_000).toISOString() });
  if (path === '/api/profiles') {
    return json(res, {
      profiles: [
        { name: 'default', display_name: 'Default', is_active: true, provider: 'openai', model: 'gpt-4.1' },
        { name: 'dev', display_name: 'Dev', is_active: false, provider: 'openai', model: 'gpt-4.1-mini' },
      ],
    });
  }
  if (path === '/api/profiles/active') return json(res, { name: 'default' });
  if (path === '/api/model/options') {
    return json(res, {
      provider: 'openai',
      model: 'gpt-4.1',
      providers: [{ name: 'OpenAI', slug: 'openai', authenticated: true, models: ['gpt-4.1', 'gpt-4.1-mini'] }],
    });
  }
  if (path === '/api/model/info') return json(res, { provider: 'openai', model: 'gpt-4.1', capabilities: {} });
  if (path === '/api/model/auxiliary') return json(res, { main: { provider: 'openai', model: 'gpt-4.1' }, tasks: [] });
  if (path === '/api/system/stats') return json(res, { cpu: 3, memory: { percent: 20 }, disk: { percent: 40 } });
  if (path === '/api/plugins/hermes-pwa/push/status') return json(res, { supported: true, subscribed: false });
  if (path === '/api/cron/delivery-targets') return json(res, { targets: [{ id: 'local', label: 'Local only' }] });
  if (path === '/api/cron/jobs') {
    return json(res, {
      jobs: [
        {
          id: 'job-1',
          name: 'Daily check',
          profile: 'default',
          prompt: 'Check status',
          schedule: '0 9 * * *',
          expression: '0 9 * * *',
          state: 'scheduled',
          next_run: new Date(Date.now() + 3600_000).toISOString(),
        },
      ],
    });
  }
  if (path === '/api/plugins/kanban/boards') {
    return json(res, { boards: [{ id: 'b-1', slug: 'main', name: 'Main', task_count: 1 }] });
  }
  if (path === '/api/plugins/kanban/board') {
    return json(res, {
      slug: 'main',
      name: 'Main',
      columns: [
        { status: 'todo', tasks: [{ id: 't-1', title: 'Task 1', status: 'todo', priority: 1, assignee: 'default', created_at: new Date().toISOString() }] },
        { status: 'ready', tasks: [] },
      ],
    });
  }
  return json(res, { ok: true });
}

async function serveStatic(req, res) {
  if ((req.url ?? '').startsWith('/api/')) return api(req, res);
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const clean = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = join(root, clean.replace(/^\//, ''));
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    const data = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'content-type': MIME['.html'] });
    res.end(data);
  }
}

function startServer() {
  const server = createServer((req, res) => void serveStatic(req, res));
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolveServer({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function assertSheet(page, name) {
  const dialog = page.getByRole('dialog', { name });
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(350);
  await dialog.evaluate((el) => {
    const target = el.querySelector('.hm-sheet__content') ?? el;
    const rect = target.getBoundingClientRect();
    const widthOk = rect.left >= -1 && rect.right <= window.innerWidth + 1;
    const heightOk = rect.top >= -1 && rect.bottom <= window.innerHeight + 1;
    if (!widthOk || !heightOk) {
      throw new Error(`Dialog content overflows viewport: ${JSON.stringify({ rect, innerWidth: window.innerWidth, innerHeight: window.innerHeight })}`);
    }
    if (el.getAttribute('aria-modal') !== 'true') throw new Error('Dialog missing aria-modal=true');
  });
  await page.keyboard.press('Tab');
  const focusInside = await dialog.evaluate((el) => el.contains(document.activeElement));
  if (!focusInside) throw new Error(`Focus escaped dialog: ${name}`);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5_000 });
}

async function assertDrawer(page) {
  await page.getByRole('button', { name: /Open menu/i }).click();
  const dialog = page.getByRole('dialog', { name: /Navigation menu/i });
  await dialog.waitFor({ state: 'visible', timeout: 5_000 });
  await page.waitForTimeout(350);
  await dialog.evaluate((el) => {
    if (el.getAttribute('aria-modal') !== 'true') throw new Error('Drawer missing aria-modal=true');
  });
  await page.keyboard.press('Tab');
  const focusInside = await dialog.evaluate((el) => el.contains(document.activeElement));
  if (!focusInside) throw new Error('Focus escaped drawer');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5_000 });
  const menuFocused = await page.getByRole('button', { name: /Open menu/i }).evaluate((el) => el === document.activeElement);
  if (!menuFocused) throw new Error('Drawer did not restore focus to menu button');
}

async function assertTapTarget(locator, label) {
  await locator.waitFor({ state: 'visible', timeout: 5_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} has no bounding box`);
  if (box.width < 44 || box.height < 44) {
    throw new Error(`${label} tap target too small: ${Math.round(box.width)}x${Math.round(box.height)}`);
  }
}

async function assertComposerTapTargets(page) {
  await assertTapTarget(page.getByLabel('Message input'), 'Message input');
  await assertTapTarget(page.getByRole('button', { name: /Add attachment/i }), 'Add attachment');
  await assertTapTarget(page.getByRole('button', { name: /Record voice/i }), 'Record voice');
  await assertTapTarget(page.getByRole('button', { name: /Turn on voice mode/i }), 'Voice mode');
  await assertTapTarget(page.getByRole('button', { name: /Send message/i }), 'Send message');
}

async function open(page, baseUrl, screen) {
  await page.goto(`${baseUrl}/?e2e=${screen}#${screen}`, { waitUntil: 'networkidle' });
  await page.setViewportSize({ width: 390, height: 844 });
}

const { server, baseUrl } = await startServer();
const browser = await chromium.launch();
const errors = [];
try {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    class MockWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        super();
        this.url = url;
        this.readyState = MockWebSocket.CONNECTING;
        this.protocol = '';
        this.extensions = '';
        this.bufferedAmount = 0;
        this.binaryType = 'blob';
        setTimeout(() => {
          this.readyState = MockWebSocket.OPEN;
          const event = new Event('open');
          this.onopen?.(event);
          this.dispatchEvent(event);
          const ready = new MessageEvent('message', {
            data: `${JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } })}\n`,
          });
          this.onmessage?.(ready);
          this.dispatchEvent(ready);
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockWebSocket.CLOSED;
        const event = new CloseEvent('close');
        this.onclose?.(event);
        this.dispatchEvent(event);
      }
    }
    window.WebSocket = MockWebSocket;
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await open(page, baseUrl, 'home');
  await assertDrawer(page);

  await open(page, baseUrl, 'chat');
  await assertComposerTapTargets(page);

  await open(page, baseUrl, 'settings');
  await page.getByRole('button', { name: /Change model/i }).click();
  await assertSheet(page, /Model/i);

  await open(page, baseUrl, 'profiles');
  await page.getByRole('button', { name: /New profile/i }).click();
  await assertSheet(page, /New profile/i);

  await open(page, baseUrl, 'kanban');
  await page.getByLabel(/Add task to To do/i).click();
  await assertSheet(page, /New task/i);

  await open(page, baseUrl, 'cron');
  await page.getByTestId('cron-new').click();
  await assertSheet(page, /New cron job/i);

  if (errors.length > 0) {
    throw new Error(`Browser errors:\n${errors.join('\n')}`);
  }
  console.log('sheet-a11y e2e passed');
} finally {
  await browser.close();
  server.close();
}
