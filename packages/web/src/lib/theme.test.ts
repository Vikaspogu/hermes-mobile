import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readTheme, THEME_STORAGE_KEY } from './theme';

describe('theme bootstrap helpers', () => {
  afterEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset.theme;
    vi.restoreAllMocks();
  });

  it('applies the stored theme to the document, as startup does', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark-mocha');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBe('dark-mocha');
  });

  it('falls back to the light system theme when nothing is stored', () => {
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores unknown stored values', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink');
    applyTheme(readTheme());
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves the system theme when switching back to system', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('resolves a dark system preference to the full dark token set', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
  it('falls back to light when matchMedia is unavailable', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(undefined as unknown as MediaQueryList);
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('light');
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
