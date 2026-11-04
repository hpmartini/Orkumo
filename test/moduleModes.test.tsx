import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TitleBar } from '../components/TitleBar';
import { ModuleMode } from '../components/ModuleMount';
import { modeCommands, type ModeEntry } from '../hooks/useModules';

// #165: a module brings its own mode; without one there is no Workflows mode at all
vi.mock('/api/modules/with-mode/ui.js', () => import('./fixtures/premium/with-mode/ui.js'));

const MODE: ModeEntry = { id: 'with-mode', label: 'Fixture Mode', icon: 'Boxes', scoped: true };

const titleBar = (modes?: ModeEntry[]) =>
  render(
    <MemoryRouter initialEntries={['/agents']}>
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
        modes={modes}
      />
    </MemoryRouter>
  );

describe('module modes (#165)', () => {
  it('a mode module gets a title-bar toggle and an "Open <label>" palette command', () => {
    titleBar([MODE]);
    const toggles = screen.getAllByRole('button', { pressed: false }).map((b) => b.ariaLabel);
    expect(toggles.indexOf('Fixture Mode')).toBeLessThan(toggles.indexOf('Board'));

    const navigate = vi.fn();
    const [cmd] = modeCommands([{ ...MODE, keywords: 'demo' }], navigate);
    expect(cmd).toMatchObject({ title: 'Open Fixture Mode', group: 'Navigate', keywords: 'demo' });
    cmd.run();
    expect(navigate).toHaveBeenCalledWith('/with-mode');
  });

  it('without modules: no Workflows toggle and no mode command', () => {
    titleBar();
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
});
