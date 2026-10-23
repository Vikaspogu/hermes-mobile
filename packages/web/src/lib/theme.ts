// M14 local preference — no server-side setting exists for this yet.
export const THEME_STORAGE_KEY = 'hermes-pwa.theme.v1';

export type ThemeSetting = 'system' | 'light' | 'dark' | 'dark-indigo' | 'dark-mocha' | 'dark-graphite';

export const THEME_OPTIONS: readonly { id: ThemeSetting; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'dark-indigo', label: 'Dark · Indigo' },
  { id: 'dark-mocha', label: 'Dark · Mocha' },
  { id: 'dark-graphite', label: 'Dark · Graphite' },
];

export function readTheme(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw && raw !== 'system' && THEME_OPTIONS.some((o) => o.id === raw) ? (raw as ThemeSetting) : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: ThemeSetting) {
  if (theme === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = theme;
  }
}
