import { describe, it, expect, vi, afterEach } from 'vitest';
import { render as rtlRender, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModuleSlot } from '../components/ModuleSlot';
import { useModules } from '../hooks/useModules';

vi.mock('/api/modules/m/ui.js', () => ({
  mount: (el: HTMLElement) => {
    el.textContent = 'hi';
  },
}));

const Slot = () => <ModuleSlot modules={useModules()} />;
// the slot hands modules a host with router navigation
const render = () => {
  const r = rtlRender(<Slot />, { wrapper: MemoryRouter });
  return { container: r.container };
};

const mockFetch = vi.fn();
global.fetch = mockFetch;

const respond = (body: unknown) =>
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) });

describe('ModuleSlot', () => {
  afterEach(() => mockFetch.mockReset());

  it('renders nothing without modules', async () => {
    respond([]);
    const { container } = render();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/modules'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a module without ui', async () => {
    respond([{ id: 'x', name: 'X', ui: false }]);
    const { container } = render();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the request fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const { container } = render();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('mounts a container for a module with ui', async () => {
    // jsdom cannot import the ui.js URL; ModuleMount logs that, which is not under test
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    respond([{ id: 'x', name: 'X', ui: true }]);
    const { container } = render();
    await waitFor(() => expect(container.querySelector('[data-module="x"]')).not.toBeNull());
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
    errorSpy.mockRestore();
  });

  it('leaves a module with a mode to its own pane', async () => {
    respond([{ id: 'm', name: 'M', ui: true, mode: { label: 'M' } }]);
    const { container } = render();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('mounts the module ui', async () => {
    respond([{ id: 'm', name: 'M', ui: true }]);
    const { container } = render();
    await waitFor(() =>
      expect(container.querySelector('[data-module="m"]')).toHaveTextContent('hi')
    );
  });
});
