import React from 'react';
import ReactDOM from 'react-dom/client';
import { configureLinks } from '@hpmartini/agents-ui';
import App from './App';
import { APP_NAME } from './constants';
import { pairing } from './utils/apiConfig';
import { installRemoteAuth } from './utils/remoteClient';

// Set document title
document.title = APP_NAME;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// Electron paired with another machine's server (ORKUMO_REMOTE): every request carries its token.
if (pairing) {
  installRemoteAuth(pairing, () => console.error('[Remote] Pairing token rejected by the server'));
}

// Links (agents-ui): the system browser through Electron's shell; its BrowserView frames any site
configureLinks({
  openExternal: window.electronAPI?.openExternal,
  embedsAnySite: !!window.electronAPI?.browserView,
});

// Bundled clients (iOS app in DevHub-pro) use their own entry around App, apiConfig and remoteClient.
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
