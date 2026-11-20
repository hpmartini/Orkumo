import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RemotePairingSection } from '../components/RemotePairingSection';

const LINK = 'devorbit://pair?url=https%3A%2F%2Fmac.tail1.ts.net&token=abc';

afterEach(() => vi.unstubAllGlobals());

describe('RemotePairingSection', () => {
  it('shows address, token and a QR code for the pairing link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ enabled: true, url: 'https://mac.tail1.ts.net', token: 'abc', link: LINK })
      )
    );
    render(<RemotePairingSection />);
    const qr = await screen.findByAltText('Pairing QR code for the iOS app');
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByText('https://mac.tail1.ts.net')).toBeTruthy();
    expect(screen.getByText(LINK)).toBeTruthy();
  });

  it('explains how to switch remote access on when it is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ enabled: false }))
    );
    render(<RemotePairingSection />);
    expect(await screen.findByText(/Remote access is off/)).toBeTruthy();
  });

  it('marks cluster as Pro and says when its module is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ enabled: false }))
    );
    render(<RemotePairingSection />);
    expect(await screen.findByText('Pro')).toBeTruthy();
    expect(screen.getByTestId('cluster-pro-hint').textContent).toMatch(/module is not installed/);
  });

  it('drops the missing-module note when the cluster module is loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        Response.json(
          String(url).endsWith('/modules')
            ? [{ id: 'cluster', name: 'Cluster', ui: true }]
            : { enabled: false }
        )
      )
    );
    render(<RemotePairingSection />);
    const hint = await screen.findByText(/provided by the DevHub-pro modules/);
    expect(hint.textContent).not.toMatch(/not installed/);
  });
});
