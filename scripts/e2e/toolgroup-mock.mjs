import { chromium } from 'playwright';

const base = 1730000000; // seconds

const CACHE_MESSAGES = [
  { id: 'u-1', role: 'user', text: 'Make remote coding feel instant.', createdAt: base },
  {
    id: 'a-1',
    role: 'assistant',
    text: 'T3 Code now treats every machine like it is right here in the room.\n\n- Three machines stay live together\n- Handoffs land before your train of thought can wander',
    createdAt: base + 120,
    toolCalls: [
      { id: 't1', name: 'terminal', input: { command: 'git status' }, output: 'On branch main\nnothing to commit' },
      { id: 't2', name: 'read', input: { path: 'src/app/App.tsx' }, output: 'export function App() { … }' },
      { id: 't3', name: 'terminal', input: { command: 'npm test' }, output: '612 tests passed' },
    ],
  },
];

const WIRE_MESSAGES = [
  { id: 'u-1', role: 'user', text: 'Make remote coding feel instant.', created_at: base },
  {
    id: 'a-1',
    role: 'assistant',
    text: CACHE_MESSAGES[1].text,
    created_at: base + 120,
    tool_calls: [
      { id: 't1', name: 'terminal', input: { command: 'git status' }, output: 'On branch main\nnothing to commit' },
      { id: 't2', name: 'read', input: { path: 'src/app/App.tsx' }, output: 'export function App() { … }' },
      { id: 't3', name: 'terminal', input: { command: 'npm test' }, output: '612 tests passed' },
    ],
  },
];

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  await context.addInitScript((msgs) => {
    window.localStorage.setItem(
      'hermes-pwa.activeSession.v4:default',
      JSON.stringify({ sessionId: 'live-1', storedSessionId: 'sess-1', streaming: false, profile: 'default', messages: msgs }),
    );
  }, CACHE_MESSAGES);
  await context.route('**/api/auth/ws-ticket', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'mock-ticket', ttl_seconds: 30 }),
  }));
  const page = await context.newPage();
  await page.routeWebSocket(/\/api\/ws/, (ws) => {
    ws.onMessage((msg) => {
      for (const line of String(msg).split('\n')) {
        if (!line.trim()) continue;
        let rpc;
        try { rpc = JSON.parse(line); } catch { continue; }
        if (rpc.id === undefined || rpc.id === null) continue;
        let result = {};
        if (rpc.method === 'session.resume') result = { session_id: 'live-1', stored_session_id: 'sess-1', messages: WIRE_MESSAGES };
        else if (rpc.method === 'session.create') result = { session_id: 'live-1', stored_session_id: 'sess-1' };
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      }
    });
  });
  page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 160)));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  page.on('websocket', (w) => console.log('[ws] opened', w.url()));
  await page.goto('http://localhost:3010/chat', { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.hm-tool-group__header', { timeout: 20000 });
  } catch (e) {
    console.log('--- page state on timeout ---');
    console.log('chat root:', await page.$('.hm-chat') !== null);
    console.log('body:', (await page.evaluate(() => document.body.innerText)).slice(0, 400));
    await page.screenshot({ path: '/tmp/toolgroup-fail.png' });
    throw e;
  }
  await page.waitForTimeout(500);
  const label = await page.textContent('.hm-tool-group__header-text');
  console.log('chip label:', JSON.stringify(label));
  await page.screenshot({ path: '/tmp/toolgroup-collapsed.png' });
  await page.click('.hm-tool-group__header');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/toolgroup-expanded.png' });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/toolgroup-light.png' });
  console.log('OK');
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
