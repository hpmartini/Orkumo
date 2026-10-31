import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import './fonts';
import { Page } from './Page';

// build.ts prerenders <Page /> into #root, so the first paint does not wait for this bundle
hydrateRoot(
  document.getElementById('root')!,
  <StrictMode>
    <Page />
  </StrictMode>
);
