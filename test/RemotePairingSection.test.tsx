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
    const qr = await screen.findByAltText('Pairing-QR-Code für die iOS-App');
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
    expect(await screen.findByText(/Remote-Zugang ist aus/)).toBeTruthy();
  });
});
