// Project settings: rename, disable with undo, merge picker, add with a server error
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProjectEntry } from '../types';
import { ProjectsSettings } from '../components/ProjectsSettings';

const api = vi.hoisted(() => ({
  fetchProjects: vi.fn(),
  setProjectDisabled: vi.fn(async () => ({})),
  renameDetectedProject: vi.fn(async () => ({})),
  mergeProject: vi.fn(async () => ({})),
  createCustomProject: vi.fn(),
  updateCustomProject: vi.fn(async () => ({})),
  deleteCustomProject: vi.fn(async () => ({})),
}));
vi.mock('../services/api', () => api);

const entry = (id: string, name: string, extra: Partial<ProjectEntry> = {}): ProjectEntry => ({
  id,
  name,
  detectedName: name,
  path: `/Users/me/PROJECTS/${name}`,
  paths: [`/Users/me/PROJECTS/${name}`],
  worktrees: [],
  source: 'detected',
  state: 'active',
  mergedInto: null,
  userNamed: false,
  sessionCount: 0,
  ...extra,
});

let projects: ProjectEntry[];
beforeEach(() => {
  projects = [
    entry('a', 'alpha', { worktrees: ['/w/1', '/w/2'], sessionCount: 3 }),
    entry('b', 'beta'),
  ];
  api.fetchProjects.mockImplementation(async () => projects);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProjectsSettings', () => {
  it('lists projects with worktree and agent counts; rename applies and reports the change', async () => {
    const onChange = vi.fn();
    render(<ProjectsSettings onChange={onChange} />);
    expect(await screen.findByText('alpha')).toBeTruthy();
    expect(screen.getByText(/2 worktrees/)).toBeTruthy();
    expect(screen.getByText(/3 agents/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Rename alpha' }));
    const input = screen.getByRole('textbox', { name: 'New name for alpha' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Alpha App{Enter}');
    expect(api.renameDetectedProject).toHaveBeenCalledWith('a', 'Alpha App');
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it('disables with an undo offer, and merges through the picker', async () => {
    render(<ProjectsSettings onChange={() => {}} />);
    await screen.findByText('alpha');

    await userEvent.click(screen.getByRole('button', { name: 'Disable beta' }));
    expect(api.setProjectDisabled).toHaveBeenCalledWith('b', true);
    await userEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    expect(api.setProjectDisabled).toHaveBeenLastCalledWith('b', false);

    await userEvent.click(screen.getByRole('button', { name: 'Merge beta into another project' }));
    await userEvent.type(screen.getByRole('combobox'), 'alp{Enter}');
    expect(api.mergeProject).toHaveBeenCalledWith('b', 'a');
  });

  it('shows disabled and merged projects in collapsed sections with their way back', async () => {
    projects = [
      entry('a', 'alpha'),
      entry('b', 'beta', { state: 'disabled' }),
      entry('c', 'gamma', { state: 'merged', mergedInto: 'a' }),
    ];
    render(<ProjectsSettings onChange={() => {}} />);
    expect(await screen.findByText(/Includes gamma/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enable beta' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Disabled (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enable beta' }));
    expect(api.setProjectDisabled).toHaveBeenCalledWith('b', false);
    await userEvent.click(screen.getByRole('button', { name: 'Merged (1)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo merge of gamma' }));
    expect(api.mergeProject).toHaveBeenCalledWith('c', null);
  });

  it("names the server's reason when an added path is no git repository", async () => {
    api.createCustomProject.mockRejectedValueOnce(
      new Error(
        'Not a git repository: /Users/me/LAB. Pick the folder that contains the repository’s .git.'
      )
    );
    render(<ProjectsSettings onChange={() => {}} />);
    await screen.findByText('alpha');
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    await userEvent.type(
      screen.getByLabelText(/Folder of a git repository/),
      '/Users/me/LAB{Enter}'
    );
    expect((await screen.findByRole('alert')).textContent).toMatch(/Not a git repository/);
    expect(api.createCustomProject).toHaveBeenCalledWith({ paths: ['/Users/me/LAB'] });
  });
});
