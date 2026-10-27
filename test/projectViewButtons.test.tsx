import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectsSection, type RailNavProps } from '../components/AgentsView/ProjectsRail';

const apps = [
  { id: 'a1', name: 'Alpha', path: '/p/alpha' },
  { id: 'b2', name: 'Beta', path: '/p/beta' },
];

const makeNav = () =>
  ({
    onOpenDashboard: vi.fn(),
    onOpenAgents: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenProjectCode: vi.fn(),
    onOpenProjectBoard: vi.fn(),
    onStartApp: vi.fn(),
    onStopApp: vi.fn(),
  }) satisfies RailNavProps;

describe('ProjectsSection view buttons', () => {
  beforeEach(() => {
    cleanup();
    localStorage.setItem('devOrbitAgentProjectsCollapsed', 'false');
  });

  it('View code / View board call the nav callbacks with the app id', () => {
    const nav = makeNav();
    render(<ProjectsSection apps={apps} nav={nav} />);

    fireEvent.click(screen.getByLabelText('View code of Beta'));
    expect(nav.onOpenProjectCode).toHaveBeenCalledWith('b2');
    fireEvent.click(screen.getByLabelText('View board of Alpha'));
    expect(nav.onOpenProjectBoard).toHaveBeenCalledWith('a1');
    expect(nav.onOpenProject).not.toHaveBeenCalled();
  });

  it('the row button still opens the project', () => {
    const nav = makeNav();
    render(<ProjectsSection apps={apps} nav={nav} />);

    fireEvent.click(screen.getByText('Alpha'));
    expect(nav.onOpenProject).toHaveBeenCalledWith('a1');
    expect(nav.onOpenProjectCode).not.toHaveBeenCalled();
  });
});
