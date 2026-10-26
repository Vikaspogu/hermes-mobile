import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(webRoot, 'index.html'), 'utf8');
const fonts = readFileSync(join(webRoot, 'src/styles/fonts.css'), 'utf8');

describe('font loading', () => {
  it('preloads the bundled primary face with a Vite-relative URL', () => {
    const link = html.match(/<link\b[^>]*rel="preload"[^>]*>/u)?.[0] ?? '';
    expect(link).toContain('as="font"');
    expect(link).toContain('crossorigin');
    expect(link).toContain('type="font/ttf"');
    const href = link.match(/href="([^"]+)"/u)?.[1] ?? '';
    expect(href).toBe('./src/assets/fonts/hanken-grotesk-400.ttf');
    expect(existsSync(join(webRoot, href))).toBe(true);
  });

  it('keeps every font face visible during download', () => {
    const faces = fonts.match(/@font-face\s*\{[^}]*\}/gu) ?? [];
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) expect(face).toContain('font-display: swap');
  });
});
