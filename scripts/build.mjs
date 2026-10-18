#!/usr/bin/env node
/**
 * Build script: packages/tab --> dashboard/dist/index.js + style.css
 *                 packages/web --> dashboard/dist/mobile/
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptsDir, '..');
const viteBin = join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vite.cmd' : 'vite',
);

function run(args, cwd) {
  console.log(`> ${args.join(' ')}`);
  execFileSync(args[0], args.slice(1), { cwd, stdio: 'inherit', env: process.env });
}

// Build tab extension (library mode --> dashboard/dist/index.js + style.css)
run([viteBin, 'build'], join(repoRoot, 'packages', 'tab'));

// Build web PWA shell (app mode --> dashboard/dist/mobile/)
run([viteBin, 'build'], join(repoRoot, 'packages', 'web'));

console.log('\n✅ Build complete. Outputs:');
console.log('  dashboard/dist/index.js     (tab extension)');
console.log('  dashboard/dist/style.css    (tab styles)');
console.log('  dashboard/dist/mobile/      (PWA app bundle)');
