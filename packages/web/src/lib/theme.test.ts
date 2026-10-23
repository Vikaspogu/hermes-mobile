import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme, readTheme, THEME_STORAGE_KEY } from './theme';

describe('theme bootstrap helpers', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('applies the stored theme to the document, as startup does', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark-mocha');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBe('dark-mocha');
  });

  it('falls back to system (no data-theme) when nothing is stored', () => {
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('clears data-theme when switching back to system', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('overwrites one non-system theme with another', () => {
    applyTheme('light');
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('round-trips the Settings write path (store, read, apply)', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark-graphite');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBe('dark-graphite');
  });
});
