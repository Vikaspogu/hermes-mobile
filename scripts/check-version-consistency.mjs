#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const readText = (path) => readFileSync(join(root, path), 'utf8');

const rootVersion = readJson('package.json').version;
const checks = [
  ['package.json', rootVersion],
  ['package-lock.json', readJson('package-lock.json').version],
  ['package-lock.json packages[""]', readJson('package-lock.json').packages?.['']?.version],
  ['packages/core/package.json', readJson('packages/core/package.json').version],
  ['packages/web/package.json', readJson('packages/web/package.json').version],
  ['packages/tab/package.json', readJson('packages/tab/package.json').version],
  ['dashboard/manifest.json', readJson('dashboard/manifest.json').version],
];

const pluginYaml = readText('plugin.yaml');
const pluginVersion = pluginYaml.match(/^version:\s*([^\s#]+)\s*$/m)?.[1];
checks.push(['plugin.yaml', pluginVersion]);

const pluginApi = readText('dashboard/plugin_api.py');
if (/"version"\s*:\s*"\d+\.\d+\.\d+"/.test(pluginApi)) {
  console.error('dashboard/plugin_api.py must not hardcode the plugin health version; use _read_package_version().');
  process.exit(1);
}

const mismatches = checks.filter(([, version]) => version !== rootVersion);
if (mismatches.length > 0) {
  console.error(`Version mismatch: expected ${rootVersion}`);
  for (const [label, version] of checks) {
    const marker = version === rootVersion ? '✓' : '✗';
    console.error(`${marker} ${label}: ${version ?? '(missing)'}`);
  }
  process.exit(1);
}

console.log(`✅ version consistency verified: ${rootVersion}`);
