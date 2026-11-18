import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/fonts.css';
import './styles/tokens.css';
import './styles/press-feedback.css';
import './pwa/install';
import { installVitePreloadErrorReload } from './pwa/preloadError';
import { registerServiceWorker } from './pwa/registerSW';
import { applyTheme, readTheme } from './lib/theme';

installVitePreloadErrorReload();
// Apply the stored theme before first render, otherwise the app flashes the
// system theme until the Settings screen mounts.
applyTheme(readTheme());
const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
const onSystemThemeChange = () => {
  if (readTheme() === 'system') applyTheme('system');
};
if (systemTheme?.addEventListener) systemTheme.addEventListener('change', onSystemThemeChange);
else systemTheme?.addListener(onSystemThemeChange);
void registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
