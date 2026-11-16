import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GithubReposPanel } from '../components/GithubReposPanel';

const repo = (slug: string, local: unknown = null) => ({
  slug,
  private: false,
  fork: false,
  archived: false,
  pushedAt: '',
  description: null,
  local,
});

afterEach(() => vi.unstubAllGlobals());

describe('GithubReposPanel', () => {
  it('clones a remote-only repo into the scan directory and toggles a local one', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = url.endsWith('/github/repos')
        ? {
            directories: ['/x/PROJECTS'],
            repos: [
              repo('me/new'),
              repo('me/here', { projectId: 'p1', name: 'here', state: 'active' }),
            ],
          }
        : { path: '/x/PROJECTS/new', projectId: 'p2', sent: init?.body };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSetDisabled = vi.fn(async () => true);
    const onCloned = vi.fn(async () => {});
    render(
      <GithubReposPanel onSetDisabled={onSetDisabled} onCloned={onCloned} onClose={() => {}} />
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Clone me/new' }));
    const cloneCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/github/clone'))!;
    expect(JSON.parse(String(cloneCall[1]!.body))).toEqual({ slug: 'me/new', dir: '/x/PROJECTS' });
    expect(onCloned).toHaveBeenCalled();
    const list = screen.getByRole('list', { name: 'GitHub repositories' });
    expect(within(list).getAllByRole('button', { name: 'Active' })).toHaveLength(2);

    await userEvent.click(within(list).getAllByRole('button', { name: 'Active' })[1]);
    expect(onSetDisabled).toHaveBeenCalledWith('p1', 'here', true);
    expect(await within(list).findByRole('button', { name: 'Disabled' })).toBeInTheDocument();
  });
});
