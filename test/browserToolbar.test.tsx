import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserPreviewPanel } from '../components/CodingView/BrowserPreviewPanel';
import { BrowserPane } from '../components/AgentsView/AgentWorkspace';

const ok = () => Promise.resolve({ success: true });

const electronApi = () => ({
  create: vi.fn(ok),
  navigate: vi.fn(ok),
  destroy: vi.fn(ok),
  resize: vi.fn(ok),
  refresh: vi.fn(ok),
  openDevTools: vi.fn(ok),
  closeDevTools: vi.fn(ok),
});

const useElectron = () => {
  const api = electronApi();
  (window as unknown as { electronAPI: unknown }).electronAPI = { browserView: api };
  return api;
};

const CONTROLS: (string | RegExp)[] = [
  'Refresh',
  'URL',
  'Switch to Desktop viewport',
  'Switch to Tablet viewport',
  'Switch to Mobile viewport',
  /^(Open|Close) DevTools$/,
  'Open in system browser',
  'Hide browser preview',
];

beforeEach(() => {
  // jsdom has no layout; the native view needs a non-empty rect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 40,
    width: 1000,
    height: 600,
  } as never);
});

afterEach(() => {
  (window as unknown as { electronAPI?: unknown }).electronAPI = undefined;
  vi.restoreAllMocks();
});

describe('one browser bar (#185)', () => {
  it.each([
    ['Electron', true],
    ['iframe', false],
  ])('AC-1: %s variant has every control in one toolbar, no title or extra bars', (_, electron) => {
    if (electron) useElectron();
    render(<BrowserPreviewPanel url="https://a.test/" appId="" onHide={() => {}} />);
    const bars = screen.getAllByRole('toolbar');
    expect(bars).toHaveLength(1);
    for (const name of CONTROLS) expect(within(bars[0]).getByLabelText(name)).toBeInTheDocument();
    expect(screen.queryByText('Browser Preview')).not.toBeInTheDocument();
  });

  it('AC-2: BrowserPane has no own title bar; maximize and one close sit in the bar', () => {
    useElectron();
    const onClose = vi.fn();
    const onMaximize = vi.fn();
    render(
      <BrowserPane
        url="https://a.test/"
        active
        onFocus={() => {}}
        onClose={onClose}
        onMaximize={onMaximize}
      />
    );
    const bar = screen.getByRole('toolbar');
    expect(screen.getAllByRole('toolbar')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Close browser' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Hide browser preview' })).not.toBeInTheDocument();
    // the url shows only in the address field, not as a separate title
    expect(screen.queryByText('https://a.test/')).not.toBeInTheDocument();
    fireEvent.click(within(bar).getByRole('button', { name: 'Move browser to its own tab' }));
    expect(onMaximize).toHaveBeenCalled();
    fireEvent.click(within(bar).getByRole('button', { name: 'Close browser' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('AC-3: refresh, url enter, devtools and viewport drive the native view', async () => {
    const api = useElectron();
    render(<BrowserPreviewPanel url="https://a.test/" appId="x" />);
    await waitFor(() => expect(api.create).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(api.refresh).toHaveBeenCalled());

    const input = screen.getByLabelText('URL');
    fireEvent.change(input, { target: { value: 'https://b.test/' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(api.navigate).toHaveBeenLastCalledWith(expect.any(String), 'https://b.test/')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open DevTools' }));
    await waitFor(() => expect(api.openDevTools).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Close DevTools' }));
    await waitFor(() => expect(api.closeDevTools).toHaveBeenCalled());

    const mobile = screen.getByRole('button', { name: 'Switch to Mobile viewport' });
    fireEvent.click(mobile);
    expect(mobile).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(api.resize).toHaveBeenLastCalledWith(expect.any(String), {
        x: 313,
        y: 40,
        width: 375,
        height: 600,
      })
    );
  });

  it('AC-3: iframe variant toggles its DevTools panel and switches viewport', () => {
    render(<BrowserPreviewPanel url="https://a.test/" appId="" />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close DevTools' }));
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Switch to Tablet viewport' }));
    expect(screen.getByTitle('App Preview').parentElement).toHaveStyle({ width: '768px' });
  });

  it('AC-4: drag props sit on a grip, never on the url field or buttons', () => {
    useElectron();
    const onDragStart = vi.fn();
    render(
      <BrowserPane
        url="https://a.test/"
        active
        onFocus={() => {}}
        onClose={() => {}}
        headerProps={{ draggable: true, onDragStart }}
      />
    );
    const bar = screen.getByRole('toolbar');
    const draggables = bar.querySelectorAll('[draggable="true"]');
    expect(draggables).toHaveLength(1);
    const grip = draggables[0];
    expect(grip.contains(screen.getByLabelText('URL'))).toBe(false);
    expect(within(grip as HTMLElement).queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('URL').closest('[draggable="true"]')).toBeNull();
    fireEvent.dragStart(grip);
    expect(onDragStart).toHaveBeenCalled();
  });

  it('AC-4: without split no grip is rendered', () => {
    useElectron();
    render(<BrowserPane url="https://a.test/" active onFocus={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('toolbar').querySelector('[draggable="true"]')).toBeNull();
  });
});
