import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('disables both screen transitions when reduced motion is requested', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'screen-transitions.css'), 'utf8');
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.hm-screen-enter-forward,\s*\.hm-screen-enter-back\s*\{\s*animation: none;/u);
});
