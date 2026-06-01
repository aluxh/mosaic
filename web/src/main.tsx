import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted fonts (v0.1.4) — replaces the Google Fonts CDN link.
// Latin subset, only the weights/styles used by web/src/index.css.
import '@fontsource/inter/latin-300.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/instrument-serif/latin-400.css';
import '@fontsource/instrument-serif/latin-400-italic.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';

import './index.css';
import { App } from './App';
import { AdminApp } from './AdminApp';

export function selectPage(pathname: string): ComponentType {
  return pathname === '/admin' ? AdminApp : App;
}

const Page = selectPage(window.location.pathname);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}
