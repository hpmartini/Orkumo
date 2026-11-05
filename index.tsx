import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { APP_NAME } from './constants';

// Set document title
document.title = APP_NAME;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// Bundled clients (iOS app in DevHub-pro) use their own entry around App, apiConfig and remoteClient.
ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
