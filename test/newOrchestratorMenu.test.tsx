// "New" menu: a general orchestrator plus one entry per role file
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NewTaskButton } from '../components/AgentsView/NewTaskButton';

describe('NewTaskButton', () => {
  it('offers the general orchestrator and each role, and starts the picked one', () => {
    const onNew = vi.fn();
    const onOpenMenu = vi.fn();
    render(
      <NewTaskButton
        onNew={onNew}
        onOpenMenu={onOpenMenu}
        roles={[{ id: 'board-orchestrator', title: 'Rolle: Board' }]}
      />
    );
    fireEvent.click(screen.getByLabelText(/More: new agent/));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
    const general = screen.getByRole('menuitem', { name: /New orchestrator/ });
    expect(general.textContent).toContain('general');
    const role = screen.getByRole('menuitem', { name: /board-orchestrator/ });
    expect(role.getAttribute('title')).toBe('Rolle: Board');
    fireEvent.click(role);
    expect(onNew).toHaveBeenCalledWith('orchestrator', 'board-orchestrator');
  });

  it('without roles the menu stays as before', () => {
    const onNew = vi.fn();
    render(<NewTaskButton onNew={onNew} />);
    fireEvent.click(screen.getByLabelText(/More: new agent/));
    fireEvent.click(screen.getByRole('menuitem', { name: /New orchestrator/ }));
    expect(onNew).toHaveBeenCalledWith('orchestrator', undefined);
    expect(screen.queryByText('general')).toBeNull();
  });
});
