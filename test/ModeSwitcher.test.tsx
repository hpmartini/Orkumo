import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ModeSwitcher, MODES, MODE_ORDER_KEY, orderModes } from '../components/ModeSwitcher';
import { TitleBar } from '../components/TitleBar';

const Location = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

const renderAt = (
  route: string,
  modes = [{ id: 'workflows', label: 'Workflows' }],
  onToggleRail?: () => void
) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <ModeSwitcher modes={modes} onToggleRail={onToggleRail} />
      <Location />
    </MemoryRouter>
  );

const LABELS = MODES.map((m) => m.label);
const button = (label: string) => screen.getByRole('button', { name: label });
const pressed = () =>
  LABELS.filter((label) => button(label).getAttribute('aria-pressed') === 'true');

const order = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));

describe('ModeSwitcher (#184)', () => {
  beforeEach(() => localStorage.removeItem(MODE_ORDER_KEY));
  it('offers the modes in order: Agents, module modes (Workflows), Board, Issues, Pull Requests, Code', () => {
    renderAt('/agents');
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Agents',
      'Workflows',
      'Board',
      'Issues',
      'Pull Requests',
      'Code',
      'Chats',
    ]);
  });

  it('Pull Requests opens /pulls and is marked there, a second click returns to /agents (#191 AC-1)', async () => {
    renderAt('/board');
    await userEvent.click(button('Pull Requests'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/pulls$/);
    expect(pressed()).toEqual(['Pull Requests']);
    await userEvent.click(button('Pull Requests'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/agents$/);
    expect(pressed()).toEqual(['Agents']);
  });

  it('Ctrl+1 … Ctrl+9 switch modes in sidebar order; other modifiers are ignored', async () => {
    renderAt('/agents');
    await userEvent.keyboard('{Control>}{3}{/Control}');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/board$/);
    await userEvent.keyboard('{Control>}{Shift>}{1}{/Shift}{/Control}');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/board$/);
    await userEvent.keyboard('{Control>}{1}{/Control}');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/agents$/);
    expect(button('Board').getAttribute('aria-keyshortcuts')).toBe('Control+3');
  });

  it('marks Pull Requests on a deep link with filters', () => {
    renderAt('/pulls?repo=o%2Fr&ci=failure');
    expect(pressed()).toEqual(['Pull Requests']);
  });

  it('without the workflows module there is no Workflows mode (#165)', () => {
    renderAt('/agents', []);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Agents',
      'Board',
      'Issues',
      'Pull Requests',
      'Code',
      'Chats',
    ]);
  });

  it('a module mode switches to its route', async () => {
    renderAt('/agents');
    await userEvent.click(button('Workflows'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/workflows$/);
    expect(pressed()).toEqual([]);
    expect(button('Workflows')).toHaveAttribute('aria-pressed', 'true');
  });

  it.each(MODES.map((m) => [m.label, m.path]))('%s switches to %s', async (label, path) => {
    renderAt(path === '/agents' ? '/board' : '/agents');
    await userEvent.click(button(label));
    expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${path}$`));
    expect(pressed()).toEqual([label]);
  });

  it('marks the active mode, also when opened by deep link', () => {
    renderAt('/board?repo=hpmartini/Orkumo&agent=job1');
    expect(pressed()).toEqual(['Board']);
  });

  it('a click on the active mode stays there and shows or hides the side panel', async () => {
    const toggle = vi.fn();
    renderAt('/code', undefined, toggle);
    await userEvent.click(button('Code'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/code$/);
    expect(toggle).toHaveBeenCalledTimes(1);
    await userEvent.click(button('Board'));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('Alt+Arrow keys reorder the modes, the order survives a remount', async () => {
    const { unmount } = renderAt('/agents');
    button('Chats').focus();
    await userEvent.keyboard('{Alt>}{ArrowUp}{ArrowUp}{/Alt}');
    expect(order()).toEqual([
      'Agents',
      'Workflows',
      'Board',
      'Issues',
      'Chats',
      'Pull Requests',
      'Code',
    ]);
    // Ctrl+N follows the new order
    await userEvent.keyboard('{Control>}{5}{/Control}');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/chats$/);
    unmount();
    renderAt('/agents');
    expect(order()).toEqual([
      'Agents',
      'Workflows',
      'Board',
      'Issues',
      'Chats',
      'Pull Requests',
      'Code',
    ]);
  });

  it('a mode the stored order does not name keeps its default place', () => {
    const modes = ['/agents', '/workflows', '/board', '/chats'].map((path) => ({ path }));
    expect(orderModes(modes, ['/chats', '/agents', '/board']).map((m) => m.path)).toEqual([
      '/chats',
      '/workflows',
      '/agents',
      '/board',
    ]);
  });

  it('marks no mode on a dashboard', () => {
    renderAt('/dashboard');
    expect(pressed()).toEqual([]);
  });
});

describe('TitleBar (#184)', () => {
  it('has no mode toggles any more, only the rocket for the global dashboard', () => {
    render(
      <MemoryRouter>
        <TitleBar
          onOpenDashboard={() => {}}
          onOpenPalette={() => {}}
          contexts={[]}
          activeId={null}
          onSelect={() => {}}
          onReorder={() => {}}
          onEdit={() => {}}
          onCreate={() => {}}
          apps={[]}
          projectDirs={[]}
        />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: 'Open global dashboard' })).toBeInTheDocument();
    for (const label of LABELS) expect(screen.queryByRole('button', { name: label })).toBeNull();
  });
});
