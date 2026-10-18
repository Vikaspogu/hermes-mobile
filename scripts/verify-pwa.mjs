import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = join(root, 'dashboard/dist/mobile');

function fail(message) {
  console.error(`❌ ${message}`);
  process.exitCode = 1;
}

function pass(message) {
  console.log(`✅ ${message}`);
}

function warn(message) {
  console.warn(`⚠️  ${message}`);
}

async function requireFile(relativePath) {
  const path = join(dist, relativePath);
  if (!existsSync(path)) {
    fail(`Missing ${relativePath}`);
    return '';
  }
  const info = await stat(path);
  if (!info.isFile()) fail(`${relativePath} is not a file`);
  pass(`${relativePath} exists`);
  return path;
}

async function pngSize(path) {
  const buf = await readFile(path);
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function pluginApiChecks() {
  const pluginApiPath = join(root, 'dashboard/plugin_api.py');
  if (!existsSync(pluginApiPath)) {
    fail('dashboard/plugin_api.py missing');
    return;
  }
  const source = await readFile(pluginApiPath, 'utf8');
  const forbiddenServices = [
    'api.qrserver.com',
    'chart.googleapis.com',
    'qrcode.tec-it.com',
  ];
  const leaks = forbiddenServices.filter((url) => source.includes(url));
  if (leaks.length > 0) {
    fail(`plugin_api.py leaks app URL to external service(s): ${leaks.join(', ')}`);
  } else {
    pass('plugin_api.py contains no known external QR service URLs');
  }
}

async function staticChecks() {
  const indexPath = await requireFile('index.html');
  const manifestPath = await requireFile('manifest.json');
  const swPath = await requireFile('service-worker.js');
  await requireFile('offline.html');

  const index = await readFile(indexPath, 'utf8');
  if (!index.includes('rel="manifest"') || !index.includes('./manifest.json')) {
    fail('index.html must link ./manifest.json');
  } else pass('index.html links relative manifest');

  if (/\s(?:src|href)="\/assets\//.test(index)) {
    fail('index.html contains absolute /assets paths; Vite base must stay relative');
  } else pass('index.html does not use absolute /assets paths');

  const assetsDir = join(dist, 'assets');
  const assets = existsSync(assetsDir) ? await readdir(assetsDir) : [];
  if (!assets.some((name) => name.endsWith('.js'))) fail('Missing built JS asset');
  else pass('Built JS asset exists');
  if (!assets.some((name) => name.endsWith('.css'))) fail('Missing built CSS asset');
  else pass('Built CSS asset exists');

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.display !== 'standalone') fail('manifest.display must be standalone');
  else pass('manifest.display is standalone');
  if (manifest.start_url !== './index.html') fail('manifest.start_url must target ./index.html for public static dashboard-plugin serving');
  else pass('manifest.start_url targets static index.html');
  if (manifest.scope !== './') fail('manifest.scope must be ./ for plugin subpath portability');
  else pass('manifest.scope is relative');

  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  for (const size of [192, 512]) {
    const icon = icons.find((entry) => String(entry.sizes).includes(`${size}x${size}`));
    if (!icon) {
      fail(`Manifest missing ${size}x${size} icon`);
      continue;
    }
    const iconPath = await requireFile(icon.src);
    try {
      const dimensions = await pngSize(iconPath);
      if (dimensions.width !== size || dimensions.height !== size) {
        fail(`${icon.src} must be ${size}x${size}, got ${dimensions.width}x${dimensions.height}`);
      } else pass(`${icon.src} dimensions are ${size}x${size}`);
    } catch (error) {
      fail(`${icon.src} is not a valid PNG: ${error.message}`);
    }
  }
  await requireFile('icons/apple-touch-icon.png');

  const sw = await readFile(swPath, 'utf8');
  if (!sw.includes("startsWith('/api/')") || !sw.includes("/api/plugins/hermes-pwa/app/")) {
    fail('service-worker.js must explicitly avoid Hermes data API caching');
  } else pass('service-worker.js contains Hermes API cache guard');
}

async function liveChecks(baseUrl) {
  const normalized = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const checks = [
    ['', 200, /text\/html/, /no-store/i],
    ['manifest.json', 200, /manifest\+json|application\/json/, /no-cache/i],
    ['service-worker.js', 200, /javascript/, /no-cache/i],
  ];

  for (const [path, expectedStatus, contentType, cacheControl] of checks) {
    const response = await fetch(`${normalized}${path}`);
    if (response.status !== expectedStatus) fail(`${path || 'index'} returned ${response.status}`);
    else pass(`${path || 'index'} returned ${expectedStatus}`);
    const type = response.headers.get('content-type') ?? '';
    if (!contentType.test(type)) fail(`${path || 'index'} content-type was ${type}`);
    else pass(`${path || 'index'} content-type ok`);
    const cache = response.headers.get('cache-control') ?? '';
    if (!cacheControl.test(cache)) fail(`${path || 'index'} cache-control was ${cache}`);
    else pass(`${path || 'index'} cache-control ok`);
    if (path === 'service-worker.js') {
      const allowed = response.headers.get('service-worker-allowed') ?? '';
      if (allowed && !allowed.endsWith('/dashboard-plugins/hermes-pwa/dist/mobile/')) {
        fail(`Service-Worker-Allowed was ${allowed}`);
      } else {
        pass(allowed ? 'Service-Worker-Allowed scope ok' : 'Service worker uses default same-directory scope');
      }
    }
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

await pluginApiChecks();
await staticChecks();
const liveUrl = getArg('--url') ?? process.env.PWA_VERIFY_URL;
if (liveUrl) await liveChecks(liveUrl);
else warn('Live header checks skipped; pass -- --url <app-url> or PWA_VERIFY_URL for final Phase 1 audit.');

if (process.exitCode) process.exit(process.exitCode);
console.log('Hermes PWA verification complete.');
