import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
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

  it('collapses the native view while a modal is open (#140)', async () => {
    const api = {
      create: vi.fn(ok),
      navigate: vi.fn(ok),
      destroy: vi.fn(ok),
      resize: vi.fn(ok),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = { browserView: api };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
    } as never);
    const { unmount } = render(<ElectronBrowserView url="https://a.test/" appId="" />);
    await waitFor(() => expect(api.resize).toHaveBeenCalled());
    const open = { x: 10, y: 20, width: 800, height: 600 };
    expect(api.resize).toHaveBeenLastCalledWith(expect.any(String), open);

    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    await waitFor(() =>
      expect(api.resize).toHaveBeenLastCalledWith(expect.any(String), {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      })
    );
    modal.remove();
    await waitFor(() => expect(api.resize).toHaveBeenLastCalledWith(expect.any(String), open));
    unmount();
  });
});

type NavState = { viewId: string; url: string; canGoBack: boolean; canGoForward: boolean };

describe('ElectronBrowserView navigation (#182)', () => {
  const setup = () => {
    let emit: (s: NavState) => void = () => {};
    const api = {
      create: vi.fn(ok),
      navigate: vi.fn(ok),
      destroy: vi.fn(ok),
      resize: vi.fn(ok),
      go: vi.fn(ok),
      onNavigate: vi.fn((cb: (s: NavState) => void) => {
        emit = cb;
        return () => {};
      }),
    };
    (window as unknown as { electronAPI: unknown }).electronAPI = { browserView: api };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    } as never);
    return { api, emit: (s: NavState) => emit(s) };
  };

  it('back/forward are disabled without history and follow navigation events', async () => {
    const { api, emit } = setup();
    const { getByLabelText, getByDisplayValue, unmount } = render(
      <ElectronBrowserView url="https://a.test/1" appId="nav" />
    );
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const back = getByLabelText('Back') as HTMLButtonElement;
    const forward = getByLabelText('Forward') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);

    const viewId = api.create.mock.calls[0][0];
    act(() =>
      emit({ viewId: 'other', url: 'https://x.test/', canGoBack: true, canGoForward: true })
    );
    expect(back.disabled).toBe(true);

    act(() => emit({ viewId, url: 'https://a.test/2', canGoBack: true, canGoForward: false }));
    expect(getByDisplayValue('https://a.test/2')).toBeTruthy();
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);

    fireEvent.click(back);
    expect(api.go).toHaveBeenCalledWith(viewId, 'back');
    act(() => emit({ viewId, url: 'https://a.test/1', canGoBack: false, canGoForward: true }));
    fireEvent.click(forward);
    expect(api.go).toHaveBeenLastCalledWith(viewId, 'forward');
    unmount();
  });

  it('the close button shows an X icon and hides the pane', async () => {
    const { api } = setup();
    const onHide = vi.fn();
    const { getByLabelText, unmount } = render(
      <ElectronBrowserView url="https://a.test/" appId="close" onHide={onHide} />
    );
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    const close = getByLabelText('Hide browser preview');
    expect(close.querySelector('svg')?.getAttribute('class')).toContain('lucide-x');
    expect(close.querySelector('.lucide-external-link')).toBeNull();
    fireEvent.click(close);
    expect(onHide).toHaveBeenCalledTimes(1);
    unmount();
  });
});
