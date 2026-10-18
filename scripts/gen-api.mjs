#!/usr/bin/env node
/**
 * Generate REST API types from Hermes OpenAPI snapshot.
 * Reads /tmp/hermes-openapi.json, outputs packages/core/src/generated/hermes-api.ts
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const input = '/tmp/hermes-openapi.json';
const genDir = join(root, '..', 'packages', 'core', 'src', 'generated');
const output = join(genDir, 'hermes-api.ts');

if (!existsSync(input)) {
  console.error(`OpenAPI snapshot not found: ${input}`);
  console.error('Generate it from Hermes source first (see AGENTS.md §6).');
  process.exit(1);
}

// Ensure generated directory exists
mkdirSync(genDir, { recursive: true });

console.log(`Generating REST types...\n  Input:  ${input}\n  Output: ${output}`);
execSync(`npx openapi-typescript "${input}" -o "${output}"`, { stdio: 'inherit' });
console.log('✅ API types generated.');
