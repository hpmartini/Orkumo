import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TitleBar } from '../components/TitleBar';

const Location = () => {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{pathname + search}</div>;
};

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
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
      <Location />
    </MemoryRouter>
  );

const VIEWS = [
  ['Workflows', '/workflows'],
  ['Board', '/board'],
  ['Code (VS Code)', '/code'],
] as const;

const button = (label: string) => screen.getByRole('button', { name: label });
const pressed = () =>
  VIEWS.filter(([label]) => button(label).getAttribute('aria-pressed') === 'true').map(
    ([label]) => label
  );

describe('TitleBar view toggles (#144)', () => {
  it.each(['/agents', '/dashboard', '/board', '/code', '/workflows', '/my-app/abc123'])(
    'shows all three buttons on %s',
    (route) => {
      renderAt(route);
      for (const [label] of VIEWS) expect(button(label)).toBeInTheDocument();
    }
  );

  it.each(VIEWS)('%s opens %s from the agents view', async (label, path) => {
    renderAt('/agents');
    await userEvent.click(button(label));
    expect(screen.getByTestId('location')).toHaveTextContent(path);
    expect(pressed()).toEqual([label]);
    expect(button(label)).toHaveClass('bg-gray-700');
  });

  it('highlights nothing on the agents view', () => {
    renderAt('/agents');
    expect(pressed()).toEqual([]);
  });

  it('highlights the open view, also when opened by deep link', () => {
    renderAt('/board?repo=hpmartini/DevHub&agent=job1');
    expect(pressed()).toEqual(['Board']);
  });

  it.each(VIEWS)('a click on the active %s button returns to the agents', async (label, path) => {
    renderAt(path);
    await userEvent.click(button(label));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/agents$/);
    expect(pressed()).toEqual([]);
  });

  it('switches directly between two views', async () => {
    renderAt('/board');
    await userEvent.click(button('Code (VS Code)'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/code$/);
    expect(pressed()).toEqual(['Code (VS Code)']);
  });
});
