import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ElectronBrowserView } from '../components/CodingView/ElectronBrowserView';

const ok = () => Promise.resolve({ success: true });

afterEach(() => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
});

describe('ElectronBrowserView', () => {
  it('a url change navigates the existing view instead of rebuilding it (#157)', async () => {
    const api = {
      create: vi.fn(ok),
      navigate: vi.fn(ok),
      destroy: vi.fn(ok),
      resize: vi.fn(ok),
      openDevTools: vi.fn(ok),
      closeDevTools: vi.fn(ok),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = { browserView: api };
    // jsdom has no layout; bounds need a non-empty rect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      toJSON: () => ({}),
    } as never);

    const { rerender, unmount } = render(<ElectronBrowserView url="https://a.test/1" appId="" />);
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));

    rerender(<ElectronBrowserView url="https://a.test/2" appId="" />);
    await waitFor(() =>
      expect(api.navigate).toHaveBeenLastCalledWith(expect.any(String), 'https://a.test/2')
    );
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.destroy).not.toHaveBeenCalled();

    unmount();
    expect(api.destroy).toHaveBeenCalledTimes(1);
  });
});
