import { chromium } from 'playwright';

const base = 1730000000;

const CACHE_MESSAGES = [
  { id: 'u-1', role: 'user', text: 'Make remote coding feel instant.', createdAt: base },
  {
    id: 'a-1', role: 'assistant',
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
    id: 'a-1', role: 'assistant', text: CACHE_MESSAGES[1].text, created_at: base + 120,
    tool_calls: [
      { id: 't1', name: 'terminal', input: { command: 'git status' }, output: 'On branch main\nnothing to commit' },
      { id: 't2', name: 'read', input: { path: 'src/app/App.tsx' }, output: 'export function App() { … }' },
      { id: 't3', name: 'terminal', input: { command: 'npm test' }, output: '612 tests passed' },
    ],
  },
];

const shot = async (page, name) => {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/redesign-${name}.png` });
  console.log('shot:', name);
};

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  await context.addInitScript((msgs) => {
    window.localStorage.setItem(
      'hermes-pwa.activeSession.v4:default',
      JSON.stringify({ sessionId: 'live-1', storedSessionId: 'sess-1', streaming: false, profile: 'default', messages: msgs }),
    );
  }, CACHE_MESSAGES);
  const page = await context.newPage();
  await page.emulateMedia({ colorScheme: 'dark' });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.type(), m.text().slice(0, 300)); });
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
  await page.route(/\/api\//, (route) => {
    if (route.request().url().includes('/api/auth/ws-ticket')) {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ticket: 'mock', ttl_seconds: 30 }) });
    } else {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });
  await page.routeWebSocket(/\/api\/ws/, (ws) => {
    console.log('[ws] mock handler fired');
    ws.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'gateway.ready', payload: {} } }));
    ws.onMessage((msg) => {
      for (const line of String(msg).split('\n')) {
        if (!line.trim()) continue;
        let rpc;
        try { rpc = JSON.parse(line); } catch { continue; }
        console.log('[ws<-]', rpc.method ?? line.slice(0, 80));
        if (rpc.id === undefined || rpc.id === null) continue;
        let result = {};
        if (rpc.method === 'session.resume') result = { session_id: 'live-1', stored_session_id: 'sess-1', messages: WIRE_MESSAGES };
        else if (rpc.method === 'session.create') result = { session_id: 'live-1', stored_session_id: 'sess-1' };
        else if (rpc.method === 'session.list') result = [];
        else if (rpc.method === 'agent.tool.list') result = [];
        else if (rpc.method === 'profile.list') result = [];
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      }
    });
  });

  await page.goto('http://localhost:3010/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: '/tmp/redesign-home.png' });
  console.log('shot: home');

  // Chats/threads tab
  try { await page.getByText(/chats|threads/i).first().click({ timeout: 3000 }); } catch { console.log('no chats tab click'); }
  await shot(page, 'threads');

  // Open the thread
  try {
    await page.getByText(/Make remote coding feel instant|Untitled|live/i).first().click({ timeout: 5000 });
    await page.waitForTimeout(800);
  } catch { console.log('no thread row click'); }
  await shot(page, 'thread-collapsed');

  // Expand tool group if present
  try {
    await page.locator('.hm-tool-group__header').first().click({ timeout: 2000 });
  } catch { console.log('no tool group header'); }
  await shot(page, 'thread-expanded');

  // Light theme
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page, 'thread-light');
  await page.emulateMedia({ colorScheme: 'dark' });

  // Settings (via More tab)
  try { await page.getByText(/^More$/i).first().click({ timeout: 3000 }); } catch { console.log('no More tab'); }
  await shot(page, 'more');
  try { await page.getByText(/^Settings$/i).first().click({ timeout: 3000 }); } catch { console.log('no settings row'); }
  await shot(page, 'settings');

  for (const row of ['Appearance', 'Connection']) {
    try {
      await page.getByText(new RegExp(`^${row}$`, 'i')).first().click({ timeout: 3000 });
      await shot(page, `settings-${row.toLowerCase()}`);
      // back
      try { await page.locator('button[aria-label*="Back" i]').first().click({ timeout: 2000 }); }
      catch { await page.keyboard.press('Escape'); }
      await page.waitForTimeout(300);
    } catch { console.log(`no settings row: ${row}`); }
  }
  console.log('OK');
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
