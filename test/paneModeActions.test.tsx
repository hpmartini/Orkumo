// AC-9: "Show in Status" toggles the orchestrator pane (tab or split, each on its own) to the
// module's view filtered on that orchestrator; only in orchestrator panes, only with a module
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

vi.mock('../components/ModuleMount', () => ({
  useModuleHost: (active: boolean) => ({ active, search: '', setSearch: () => {} }),
  ModuleMount: ({ id, host }: { id: string; host: { search: string; pane?: object } }) => (
    <div data-mount={id} data-search={host.search} data-pane={JSON.stringify(host.pane)} />
  ),
}));

import { usePaneModes } from '../components/PaneModeActions';

const STATUS = { id: 'status', label: 'Status', icon: 'Layers', orchestratorFilter: true };
const OTHER = { id: 'flows', label: 'Flows' };
const pane = (paneId: string, over = {}) => ({
  paneId,
  orchestrator: true,
  role: null,
  session: { id: paneId },
  ...over,
});

describe('usePaneModes', () => {
  it('toggles each pane on its own between the agent and the filtered view', () => {
    const { result } = renderHook(() => usePaneModes([OTHER, STATUS]));
    const a = pane('omp-1', { role: 'release' });
    const b = pane('omp-2');
    expect(result.current.renderPaneView(a)).toBeNull();

    const first = render(<>{result.current.renderPaneActions(a)}</>);
    const button = screen.getByRole('button', { name: 'Show in Status' });
    expect(button).toHaveAttribute('aria-pressed', 'false');
    act(() => fireEvent.click(button));
    first.unmount();

    // pane a shows the module filtered on its role; pane b is untouched
    render(<>{result.current.renderPaneView(a)}</>);
    const mount = document.querySelector('[data-mount="status"]')!;
    expect(mount).toHaveAttribute('data-search', 'orchestrator=release');
    expect(JSON.parse(mount.getAttribute('data-pane')!)).toEqual({ orchestrator: 'release' });
    expect(result.current.renderPaneView(b)).toBeNull();
    render(<>{result.current.renderPaneActions(a)}</>);
    expect(screen.getByRole('button', { name: 'Show in Status' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    // Esc in the view goes back to the agent
    act(() => fireEvent.keyDown(mount, { key: 'Escape' }));
    expect(result.current.renderPaneView(a)).toBeNull();
  });

  it('keys a roleless orchestrator by its agent id', () => {
    const { result } = renderHook(() => usePaneModes([STATUS]));
    render(<>{result.current.renderPaneActions(pane('omp-2'))}</>);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Show in Status' })));
    render(<>{result.current.renderPaneView(pane('omp-2'))}</>);
    expect(document.querySelector('[data-mount="status"]')).toHaveAttribute(
      'data-search',
      'orchestrator=omp-2'
    );
  });

  it('renders nothing in a worker pane or without a filtering module', () => {
    const { result } = renderHook(() => usePaneModes([STATUS]));
    expect(result.current.renderPaneActions(pane('w', { orchestrator: false }))).toBeNull();
    expect(result.current.renderPaneView(pane('w', { orchestrator: false }))).toBeNull();
    const other = renderHook(() => usePaneModes([OTHER]));
    expect(other.result.current.renderPaneActions(pane('omp-1'))).toBeNull();
  });
});
