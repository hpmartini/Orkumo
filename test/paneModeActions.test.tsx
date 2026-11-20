// AC-9: "Show in Status" in orchestrator panes only, and only when a module declares the filter
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { paneModeActions } from '../components/PaneModeActions';

const STATUS = { id: 'status', label: 'Status', icon: 'Layers', orchestratorFilter: true };
const OTHER = { id: 'flows', label: 'Flows' };
const pane = (over = {}) => ({ orchestrator: true, role: null, session: { id: 'omp-1' }, ...over });

describe('paneModeActions', () => {
  it('opens the mode filtered by the role id, else the agent id', () => {
    const navigate = vi.fn();
    const actions = paneModeActions([OTHER, STATUS], navigate);
    const { unmount } = render(<>{actions(pane({ role: 'release' }))}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Show in Status' }));
    expect(navigate).toHaveBeenLastCalledWith('/status?orchestrator=release');
    unmount();
    render(<>{actions(pane())}</>);
    fireEvent.click(screen.getByRole('button', { name: 'Show in Status' }));
    expect(navigate).toHaveBeenLastCalledWith('/status?orchestrator=omp-1');
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('renders nothing in a worker pane or without a filtering module', () => {
    expect(paneModeActions([STATUS], vi.fn())(pane({ orchestrator: false }))).toBeNull();
    expect(paneModeActions([OTHER], vi.fn())(pane())).toBeNull();
  });
});
