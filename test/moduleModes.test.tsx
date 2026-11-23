import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ModeSwitcher } from '../components/ModeSwitcher';
import { ModuleMode, type ModeShell, type ModuleHost } from '../components/ModuleMount';
import { RailOutletContext } from '@hpmartini/agents-ui/components/AgentsView/railOutlet';
import { getAgentTarget, resetAgentTarget } from '../utils/agentTarget';
import { modeCommands, type ModeEntry } from '../hooks/useModules';

// #165: a module brings its own mode; without one there is no Workflows mode at all
vi.mock('/api/modules/with-mode/ui.js', () => import('./fixtures/premium/with-mode/ui.js'));
// A `rail` mode: keeps the last host it got, so the test reads its fields
const seen: { host: ModuleHost | null } = { host: null };
vi.mock('/api/modules/with-rail/ui.js', () => ({
  mount: (_el: HTMLElement, host: ModuleHost) => {
    seen.host = host;
    return { update: (next: ModuleHost) => (seen.host = next) };
  },
}));

const MODE: ModeEntry = { id: 'with-mode', label: 'Fixture Mode', icon: 'Boxes', scoped: true };

// #184: mode toggles live in the mode bar next to the robot, not in the title bar
const modeBar = (modes?: ModeEntry[]) =>
  render(
    <MemoryRouter initialEntries={['/agents']}>
      <ModeSwitcher modes={modes} />
    </MemoryRouter>
  );

describe('module modes (#165)', () => {
  it('a mode module gets a mode-bar toggle and an "Open <label>" palette command', () => {
    modeBar([MODE]);
    const toggles = screen.getAllByRole('button', { pressed: false }).map((b) => b.ariaLabel);
    expect(toggles.indexOf('Fixture Mode')).toBeLessThan(toggles.indexOf('Board'));

    const navigate = vi.fn();
    const [cmd] = modeCommands([{ ...MODE, keywords: 'demo' }], navigate);
    expect(cmd).toMatchObject({ title: 'Open Fixture Mode', group: 'Navigate', keywords: 'demo' });
    cmd.run();
    expect(navigate).toHaveBeenCalledWith('/with-mode');
  });

  it('without modules: no Workflows toggle and no mode command', () => {
    modeBar();
    expect(screen.queryByRole('button', { name: /workflow/i })).toBeNull();
    expect(modeCommands([], vi.fn())).toEqual([]);
  });

  it('ModuleMode mounts the module ui and forwards `active` via update', async () => {
    let setActive: (v: boolean) => void = () => {};
    const Harness = () => {
      const [active, set] = useState(false);
      setActive = set;
      return <ModuleMode id="with-mode" active={active} />;
    };
    const { container } = render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    );
    const el = () => container.querySelector('[data-module="with-mode"]');
    await waitFor(() => expect(el()).toHaveTextContent('active=false'));
    act(() => setActive(true));
    expect(el()).toHaveTextContent('active=true');
  });

  it('a `rail` mode gets the rail column while visible, the workspace switch and openAgent', async () => {
    const outlet = document.createElement('div');
    const shell: ModeShell = { workspace: false, showWorkspace: vi.fn(), openAgent: vi.fn() };
    const Harness = ({ active, withShell }: { active: boolean; withShell: boolean }) => (
      <RailOutletContext.Provider value={outlet}>
        <ModuleMode id="with-rail" active={active} shell={withShell ? shell : undefined} />
      </RailOutletContext.Provider>
    );
    const view = render(
      <MemoryRouter>
        <Harness active withShell />
      </MemoryRouter>
    );
    await waitFor(() => expect(seen.host?.rail).toBe(outlet));
    seen.host!.showWorkspace(true);
    seen.host!.openAgent('job-1', '/modules/mesh/peer/box');
    expect(shell.showWorkspace).toHaveBeenCalledWith(true);
    expect(shell.openAgent).toHaveBeenCalledWith('job-1', '/modules/mesh/peer/box');

    // hidden: no rail column, even though every route below the agents view sees the outlet
    view.rerender(
      <MemoryRouter>
        <Harness active={false} withShell />
      </MemoryRouter>
    );
    expect(seen.host?.rail).toBeNull();

    // a mode without `rail` never gets the column; its openAgent sets the target and opens Agents
    view.rerender(
      <MemoryRouter>
        <Harness active withShell={false} />
      </MemoryRouter>
    );
    expect(seen.host?.rail).toBeNull();
    expect(seen.host?.workspace).toBe(false);
    act(() => seen.host!.openAgent('job-2', 'https://evil.example'));
    expect(getAgentTarget()).toBe('');
    act(() => seen.host!.openAgent('job-2', '/modules/mesh/peer/box'));
    expect(getAgentTarget()).toBe('/modules/mesh/peer/box');
    resetAgentTarget();
  });
});
