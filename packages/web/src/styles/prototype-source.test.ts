import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prototype.css'), 'utf8');
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/App.tsx'), 'utf8');

describe('loading hero animation', () => {
  it('animates the brand mark with transform/opacity-only keyframes', () => {
    expect(css).toContain('@keyframes hm-brand-float');
    expect(css).toContain('@keyframes hm-brand-twinkle');
    expect(css).toContain('@keyframes hm-brand-breathe');
    for (const name of ['hm-brand-float', 'hm-brand-twinkle', 'hm-brand-breathe']) {
      const block = css.match(new RegExp(`@keyframes ${name} \\{([^}]|\\}(?!\\s*\\}))*\\}\\s*\\}`))?.[0] ?? '';
      expect(block.length).toBeGreaterThan(0);
      expect(block).not.toMatch(/(width|height|top|left|right|bottom|margin|padding|background|border|color)(-\w+)?\s*:|filter\s*:|box-shadow/u);
    }
    // no filter on the animated mark — it would force re-filtering every frame
    expect(css).not.toMatch(/\.hm-brand-hero \.hm-brand__mark \{[^}]*filter:/);
  });

  it('respects prefers-reduced-motion and stops on terminal states', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain('.hm-brand-hero--static .hm-brand__mark');
    expect(app).toContain('hm-brand-hero--static');
  });

  it('keeps the decorative hero hidden from assistive tech, status text readable', () => {
    expect(app).toContain('aria-hidden="true"');
    expect(app).toContain('hm-brand-status');
    // orb spans were removed: no dead DOM nodes
    expect(app).not.toContain('hm-brand-orb');
  });
});
