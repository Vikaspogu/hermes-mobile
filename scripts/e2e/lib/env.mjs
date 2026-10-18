import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_APP_URL = 'http://127.0.0.1:9119/api/plugins/hermes-pwa/app/';

const ENV_FILES = [
  resolve(process.cwd(), '.env'),
  resolve(process.env.HERMES_HOME || '', '.env'),
].filter(Boolean);

function parseDotEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;
  let value = match[2] ?? '';
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  value = value.replace(/\\n/g, '\n');
  return [match[1], value];
}

function loadEnvFiles() {
  const loaded = {};
  for (const file of ENV_FILES) {
    if (!file || !existsSync(file)) continue;
    const content = readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseDotEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined && loaded[key] === undefined) {
        loaded[key] = value;
      }
    }
  }
  return loaded;
}

const DOTENV = loadEnvFiles();

function firstPresent(names) {
  for (const name of names) {
    const value = process.env[name] ?? DOTENV[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function boolEnv(names) {
  const value = firstPresent(names);
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeUrl(raw) {
  const value = raw || DEFAULT_APP_URL;
  const url = new URL(value);
  if (!url.pathname.endsWith('/') && !url.pathname.endsWith('.html')) {
    url.pathname = `${url.pathname}/`;
  }
  return url.toString();
}

function safePresence(value) {
  return value ? 'present' : 'missing';
}

export function loadE2EEnv({ requireAuth = false, requireBaseUrl = true } = {}) {
  const baseUrl = normalizeUrl(firstPresent([
    'HERMES_PWA_E2E_BASE_URL',
    'PWA_VERIFY_URL',
    'HERMES_PWA_URL',
    'HERMES_DASHBOARD_URL',
    'DASHBOARD_URL',
  ]));

  const username = firstPresent([
    'HERMES_PWA_E2E_USERNAME',
    'HERMES_DASHBOARD_BASIC_AUTH_USERNAME',
    'HERMES_DASHBOARD_USERNAME',
    'HERMES_USERNAME',
    'DASHBOARD_USERNAME',
  ]);
  const password = firstPresent([
    'HERMES_PWA_E2E_PASSWORD',
    'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD',
    'HERMES_DASHBOARD_PASSWORD',
    'HERMES_PASSWORD',
    'DASHBOARD_PASSWORD',
  ]);
  const profile = firstPresent(['HERMES_PWA_E2E_PROFILE', 'HERMES_PROFILE']) || 'default';
  const headless = !boolEnv(['HERMES_PWA_E2E_HEADED', 'PWDEBUG']);
  const approvalEnabled = boolEnv(['HERMES_PWA_E2E_APPROVAL']);
  const pushEnabled = boolEnv(['HERMES_PWA_E2E_PUSH']);

  const missing = [];
  if (requireBaseUrl && !baseUrl) missing.push('HERMES_PWA_E2E_BASE_URL or PWA_VERIFY_URL');
  if (requireAuth && (!username || !password)) {
    missing.push('HERMES_PWA_E2E_USERNAME/HERMES_PWA_E2E_PASSWORD or HERMES_DASHBOARD_BASIC_AUTH_USERNAME/HERMES_DASHBOARD_BASIC_AUTH_PASSWORD');
  }
  if (missing.length) {
    throw new Error(`Missing E2E environment: ${missing.join(', ')}`);
  }

  return {
    baseUrl,
    username,
    password,
    profile,
    headless,
    approvalEnabled,
    pushEnabled,
    diagnostics: {
      baseUrl: safePresence(baseUrl),
      username: safePresence(username),
      password: safePresence(password),
      profile: safePresence(profile),
      approvalEnabled,
      pushEnabled,
      dotenvFilesLoaded: ENV_FILES.filter((file) => file && existsSync(file)).map((file) => file.replace(process.env.HOME || '', '~')),
    },
  };
}

export function withHash(url, hash) {
  const next = new URL(url);
  next.hash = hash.startsWith('#') ? hash : `#/${hash.replace(/^\//, '')}`;
  return next.toString();
}
