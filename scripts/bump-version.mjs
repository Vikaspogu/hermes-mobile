#!/usr/bin/env node
// Bump the release version across every file that must stay in lockstep.
//
// Usage:  node scripts/bump-version.mjs <new-version>
//   e.g.  node scripts/bump-version.mjs 0.1.1
//
// Updates package.json (root + workspaces), dashboard/manifest.json, plugin.yaml,
// and packages/web/src/app/version.ts, then regenerates package-lock.json so
// `version:check` and `npm ci` stay happy. Run `npm run version:check` afterwards
// (the `release:bump` npm script does this for you).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const newVersion = process.argv[2];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
if (!newVersion || !SEMVER.test(newVersion)) {
  console.error('Usage: node scripts/bump-version.mjs <new-version>  (e.g. 0.1.1)');
  console.error(newVersion ? `"${newVersion}" is not a valid x.y.z version.` : 'No version provided.');
  process.exit(1);
}

const read = (p) => readFileSync(join(root, p), 'utf8');
const write = (p, s) => writeFileSync(join(root, p), s);

const oldVersion = JSON.parse(read('package.json')).version;
if (oldVersion === newVersion) {
  console.error(`Version is already ${newVersion} — nothing to do.`);
  process.exit(1);
}

// JSON manifests: replace the exact `"version": "<old>"` field, preserving formatting.
const jsonFiles = [
  'package.json',
  'packages/core/package.json',
  'packages/web/package.json',
  'packages/tab/package.json',
  'dashboard/manifest.json',
];
const jsonNeedle = `"version": "${oldVersion}"`;
for (const file of jsonFiles) {
  const text = read(file);
  if (!text.includes(jsonNeedle)) {
    console.error(`✗ ${file}: could not find ${jsonNeedle} — aborting (no files changed).`);
    process.exit(1);
  }
  write(file, text.replace(jsonNeedle, `"version": "${newVersion}"`));
}

// plugin.yaml: the `version:` line.
const yaml = read('plugin.yaml');
const yamlRe = /^version:\s*.+$/m;
if (!yamlRe.test(yaml)) {
  console.error('✗ plugin.yaml: no `version:` line found — aborting.');
  process.exit(1);
}
write('plugin.yaml', yaml.replace(yamlRe, `version: ${newVersion}`));

// version.ts: the in-app release label.
const verTs = read('packages/web/src/app/version.ts');
const tsNeedle = `HERMES_PWA_RELEASE_VERSION = '${oldVersion}'`;
if (!verTs.includes(tsNeedle)) {
  console.error(`✗ packages/web/src/app/version.ts: could not find ${tsNeedle} — aborting.`);
  process.exit(1);
}
write('packages/web/src/app/version.ts', verTs.replace(tsNeedle, `HERMES_PWA_RELEASE_VERSION = '${newVersion}'`));

// Regenerate the lockfile so its version fields (and workspace entries) follow.
console.log('Syncing package-lock.json ...');
execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
  stdio: 'inherit',
});

// Fail loudly if anything drifted.
console.log('Verifying version consistency ...');
execFileSync('node', ['scripts/check-version-consistency.mjs'], { stdio: 'inherit' });

console.log(`\n✅ Bumped ${oldVersion} → ${newVersion}`);
console.log('Next:');
console.log(`  git commit -am "release ${newVersion}"`);
console.log(`  git tag v${newVersion} && git push && git push origin v${newVersion}   # CI publishes to npm`);
