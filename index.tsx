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
let lastLink = '';
function handleLink(link: string) {
  // appUrlOpen and getLaunchUrl() can both deliver the same link
  if (link === lastLink) return;
  lastLink = link;
  const paired = parsePairingLink(link);
  // getLaunchUrl() repeats the launch link after the reload below; an unchanged pairing is a no-op.
  const changed = paired && (paired.url !== pairing?.url || paired.token !== pairing?.token);
  // Any app can open a devorbit:// link, so a pairing is only applied after the user confirms the host.
  if (
    paired &&
    changed &&
    !isRejectedToken(paired.token) &&
    window.confirm(`Mit DevOrbit-Server ${new URL(paired.url).host} verbinden?`)
  ) {
    savePairing(paired);
    window.location.hash = '#/agents';
    // WKWebView drops a reload issued while the confirm alert is still closing
    setTimeout(() => window.location.reload(), 300);
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
