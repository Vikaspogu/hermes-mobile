#!/usr/bin/env node
/**
 * Hermes PWA plugin installer.
 *
 * Usage:
 *   npx hermes-pwa install
 *   npx hermes-pwa install --dry-run
 *   npx hermes-pwa install --symlink
 *
 * Behavior:
 *   1. Locate HERMES_HOME from the env var or fall back to ~/.hermes
 *   2. Ensure HERMES_HOME/plugins exists
 *   3. Copy (or symlink) this repo into HERMES_HOME/plugins/hermes-pwa
 *   4. Print the next steps for the user
 *
 * Safety rules:
 *   - Never writes secrets or config files.
 *   - Never requires root (fails fast if the target is not writable).
 *   - Works on Windows, macOS and Linux paths.
 */

import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COPY_PAYLOAD = ['dashboard', 'plugin.yaml', '__init__.py', 'push_common.py', 'LICENSE', 'NOTICE', 'README.md', 'package.json'];

async function copyWhitelistedPayload(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of COPY_PAYLOAD) {
    const sourcePath = join(src, entry);
    const destPath = join(dest, entry);
    try {
      await lstat(sourcePath);
    } catch (err) {
      if (err.code === 'ENOENT') continue;
      throw err;
    }
    await cp(sourcePath, destPath, { recursive: true, dereference: true });
  }
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0;
}

function parseArgs() {
  return {
    dryRun: getArg('--dry-run'),
    symlink: getArg('--symlink'),
    force: getArg('--force'),
    help: getArg('--help') || getArg('-h'),
  };
}

function printHelp() {
  console.log(`Hermes PWA plugin installer

Usage:
  npx hermes-pwa install [options]

Options:
  --dry-run    Show what would happen without changing the filesystem.
  --symlink    Create a symlink instead of copying files (useful for development).
  --force      Explicitly replace any previous install (default behavior; kept for update docs).
  -h, --help   Show this message.
`);
}

async function readPackageVersion(src) {
  const raw = await readFile(join(src, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  return typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
}

async function writeInstallMarker(dest, src) {
  const version = await readPackageVersion(src);
  const marker = {
    install_method: 'npm',
    package: 'hermes-pwa',
    version,
    installed_at: new Date().toISOString(),
  };
  await writeFile(join(dest, '.hermes-pwa-install.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
}

async function install() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const hermesHome = process.env.HERMES_HOME
    ? resolve(process.env.HERMES_HOME)
    : join(homedir(), '.hermes');

  const pluginsDir = join(hermesHome, 'plugins');
  const dest = join(pluginsDir, 'hermes-pwa');
  const src = resolve(join(__dirname, '..'));

  // Sanity checks
  if (src === dest) {
    console.error('Error: source and destination are the same path.');
    process.exit(1);
  }

  console.log(`HERMES_HOME: ${hermesHome}`);
  console.log(`Source:      ${src}`);
  console.log(`Destination: ${dest}`);
  console.log(`Mode:        ${args.symlink ? 'symlink' : 'copy'}${args.dryRun ? ' (dry-run)' : ''}${args.force ? ' --force' : ''}`);

  if (args.dryRun) {
    console.log('\nDry run complete. No files were changed.');
    console.log(`\nNext steps (not executed because of --dry-run):`);
    console.log(`  1. mkdir -p ${pluginsDir}`);
    console.log(`  2. ${args.symlink ? 'symlink' : `copy whitelisted plugin payload (${COPY_PAYLOAD.join(', ')})`} ${src} → ${dest}`);
    console.log(`  3. Restart Hermes Dashboard/gateway`);
    console.log(`  4. Open Hermes Dashboard and click the Mobile tab`);
    process.exit(0);
  }

  // Ensure plugins directory exists
  try {
    await mkdir(pluginsDir, { recursive: true });
  } catch (err) {
    console.error(`Error: unable to create ${pluginsDir}: ${err.message}`);
    process.exit(1);
  }

  // Remove previous install if it exists
  try {
    const st = await lstat(dest);
    if (st.isSymbolicLink()) {
      await rm(dest);
    } else if (st.isDirectory()) {
      await rm(dest, { recursive: true, force: true });
    } else {
      await rm(dest, { force: true });
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Error: unable to remove previous install at ${dest}: ${err.message}`);
      process.exit(1);
    }
  }

  // Install
  try {
    if (args.symlink) {
      await symlink(src, dest, process.platform === 'win32' ? 'junction' : 'dir');
    } else {
      // Copy only the distributable plugin payload. Do not copy the whole source
      // checkout: it may contain .git, private docs, local screenshots, logs, or
      // other disposable agent artifacts.
      await copyWhitelistedPayload(src, dest);
      await writeInstallMarker(dest, src);
    }
  } catch (err) {
    console.error(`Error: install failed: ${err.message}`);
    process.exit(1);
  }

  console.log('\n✅ Hermes PWA plugin installed.');
  console.log('\nNext steps:');
  console.log('  1. Restart Hermes Dashboard/gateway if it is already running.');
  console.log('  2. Open Hermes Dashboard in your browser.');
  console.log('  3. Click the "Mobile" tab.');
  console.log('  4. Follow the on-screen instructions to install the PWA on your phone.\n');
}

await install();
