import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ModeSwitcher, MODES } from '../components/ModeSwitcher';
import { TitleBar } from '../components/TitleBar';

const Location = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

const renderAt = (route: string, modes = [{ id: 'workflows', label: 'Workflows' }]) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <ModeSwitcher modes={modes} />
      <Location />
    </MemoryRouter>
  );

const LABELS = MODES.map((m) => m.label);
const button = (label: string) => screen.getByRole('button', { name: label });
const pressed = () =>
  LABELS.filter((label) => button(label).getAttribute('aria-pressed') === 'true');

describe('ModeSwitcher (#184)', () => {
  it('offers the modes in order: Agents, module modes (Workflows), Board, Code', () => {
    renderAt('/agents');
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('title'))).toEqual([
      'Agents',
      'Workflows',
      'Board',
      'Code',
    ]);
  });

  it('without the workflows module there is no Workflows mode (#165)', () => {
    renderAt('/agents', []);
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('title'))).toEqual([
      'Agents',
      'Board',
      'Code',
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

  it('a click on the active mode stays there', async () => {
    renderAt('/code');
    await userEvent.click(button('Code'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/code$/);
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
