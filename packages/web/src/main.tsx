import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './styles/fonts.css';
import './styles/tokens.css';
import './pwa/install';
import { installVitePreloadErrorReload } from './pwa/preloadError';
import { registerServiceWorker } from './pwa/registerSW';

installVitePreloadErrorReload();
void registerServiceWorker();

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
