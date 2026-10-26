import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { ModuleSlot } from '../components/ModuleSlot';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const respond = (body: unknown) =>
  mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(body) });

describe('ModuleSlot', () => {
  afterEach(() => mockFetch.mockReset());

  it('renders nothing without modules', async () => {
    respond([]);
    const { container } = render(<ModuleSlot />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledWith('/api/modules'));
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a module without ui', async () => {
    respond([{ id: 'x', name: 'X', ui: false }]);
    const { container } = render(<ModuleSlot />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the request fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('offline'));
    const { container } = render(<ModuleSlot />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
