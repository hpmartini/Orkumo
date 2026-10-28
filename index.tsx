import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as CapacitorApp } from '@capacitor/app';
import App from './App';
import { PairingScreen } from './components/PairingScreen';
import { APP_NAME } from './constants';
import { isNativeApp, pairing } from './utils/apiConfig';
import {
  forgetToken,
  installRemoteAuth,
  isRejectedToken,
  parseOpenLink,
  parsePairingLink,
  savePairing,
} from './utils/remoteClient';

// Set document title
document.title = APP_NAME;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

// iOS app: deep links pair the device (devorbit://pair?…) or open a view (devorbit://open?path=…).
function handleLink(link: string) {
  const paired = parsePairingLink(link);
  // getLaunchUrl() repeats the launch link after the reload below; an unchanged pairing is a no-op.
  const changed = paired && (paired.url !== pairing?.url || paired.token !== pairing?.token);
  if (paired && changed && !isRejectedToken(paired.token)) {
    savePairing(paired);
    window.location.hash = '#/agents';
    window.location.reload();
    return;
  }
  if (paired) return;
  const path = parseOpenLink(link);
  // A bare hash change does not reach react-router's listener in WKWebView; announce it.
  if (path) {
    window.history.pushState(null, '', `#${path}`);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  }
}

if (isNativeApp) {
  CapacitorApp.addListener('appUrlOpen', ({ url }) => handleLink(url));
  CapacitorApp.getLaunchUrl().then((launch) => launch?.url && handleLink(launch.url));
  if (pairing) {
    installRemoteAuth(pairing, () => {
      forgetToken();
      window.location.reload();
    });
  }
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>{isNativeApp && !pairing ? <PairingScreen /> : <App />}</React.StrictMode>
);
