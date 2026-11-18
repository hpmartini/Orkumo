// Artifacts view: Claude artifacts (claude.ai pages) and Files as two sections, counts kept apart
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../services/agentsApi', async (orig) => ({
  ...(await orig<typeof import('../services/agentsApi')>()),
  fetchChatArtifacts: vi.fn(() => new Promise(() => {})),
  fetchChatArtifactContent: vi.fn(async () => ({
    path: '',
    content: '<html></html>',
    size: 13,
    mtime: 1,
  })),
}));
const openFile = vi.fn();
// jsdom has no layout
window.HTMLElement.prototype.scrollIntoView = vi.fn();
vi.mock('../utils/openFile', () => ({ openFile: (...a: unknown[]) => openFile(...a) }));

const { ChatArtifactsButton, ChatArtifactsModal, artifactRefreshKey } =
  await import('../components/AgentsView/Chat/ChatArtifacts');
import type { ChatArtifacts } from '../services/agentsApi';
import type { ChatMessage } from '../utils/chatEvents';

const page = (over: Partial<ChatArtifacts['pages'][number]>): ChatArtifacts['pages'][number] => ({
  url: 'https://claude.ai/artifact/AaaAaa111',
  source: 'published',
  title: 'Sales KPI',
  label: 'Colors fixed',
  description: 'Team metrics',
  version: 50,
  updatedAt: 1794507971000,
  file: '/w/app/kpi.html',
  type: 'Dashboard',
  ...over,
});
const file = (name: string, action: 'created' | 'edited') => ({
  path: `/w/app/${name}`,
  name,
  kind: 'file' as const,
  action,
  size: 10,
  mtime: 1,
  exists: true,
});

const artifacts: ChatArtifacts = {
  pages: [
    page({}),
    page({
      url: 'https://claude.ai/artifact/Read0',
      source: 'read',
      title: null,
      label: null,
      version: null,
      file: null,
      type: 'Page',
    }),
  ],
  files: [file('kpi.html', 'created'), file('a.ts', 'edited')],
};

describe('ChatArtifactsButton', () => {
  it('counts Claude artifacts and files apart; a page only read is not counted', () => {
    render(<ChatArtifactsButton artifacts={artifacts} onOpen={() => {}} />);
    expect(screen.getByRole('button').textContent).toBe('1 artifact · 2 files');
  });

  it('only files, only pages, nothing', () => {
    const { rerender, container } = render(
      <ChatArtifactsButton
        artifacts={{ pages: [], files: [file('a.ts', 'edited')] }}
        onOpen={() => {}}
      />
    );
    expect(screen.getByRole('button').textContent).toBe('1 file');
    rerender(
      <ChatArtifactsButton artifacts={{ pages: [page({})], files: [] }} onOpen={() => {}} />
    );
    expect(screen.getByRole('button').textContent).toBe('1 artifact');
    rerender(<ChatArtifactsButton artifacts={{ pages: [], files: [] }} onOpen={() => {}} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('ChatArtifactsModal', () => {
  it('shows Claude Artifacts and Files as two sections, the page first with its facts', () => {
    render(
      <ChatArtifactsModal
        chatId="c1"
        cwd="/w/app"
        title="Agent"
        artifacts={artifacts}
        onClose={() => {}}
      />
    );
    const sections = screen.getAllByRole('group');
    expect(sections.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Claude Artifacts',
      'Files',
    ]);
    expect(within(sections[0]).getAllByRole('option')).toHaveLength(2);
    expect(within(sections[1]).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('1 artifact · 2 files from Agent')).toBeTruthy();

    // the newest page is selected: type, version, label, description, source
    const link = screen.getByRole('link', { name: /Open on claude.ai/ });
    expect(link.getAttribute('href')).toBe('https://claude.ai/artifact/AaaAaa111');
    expect(link.getAttribute('target')).toBe('_blank');
    for (const fact of ['Dashboard', '50', 'Colors fixed', 'Team metrics', 'kpi.html'])
      expect(screen.getAllByText(fact).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Open source/ }));
    expect(openFile).toHaveBeenCalledWith('/w/app/kpi.html', '/w/app', { editor: true });
  });

  it('a page without a known source cannot open one; a file keeps its own actions', () => {
    render(
      <ChatArtifactsModal
        chatId="c1"
        cwd="/w/app"
        title="Agent"
        artifacts={artifacts}
        onClose={() => {}}
      />
    );
    fireEvent.click(screen.getByText('Read0'));
    expect(screen.getByRole('button', { name: /Open source/ }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Read only')).toBeTruthy();
    fireEvent.click(screen.getByText('a.ts'));
    expect(screen.getByRole('button', { name: /Open in VS Code/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open on claude.ai/ })).toBeNull();
  });
});

describe('artifactRefreshKey', () => {
  it('a finished Artifact call refreshes the list', () => {
    const msg = (result?: string) =>
      [
        { kind: 'assistant', blocks: [{ type: 'tool', name: 'Artifact', result }] },
      ] as unknown as ChatMessage[];
    expect(artifactRefreshKey(msg(), 0)).not.toBe(artifactRefreshKey(msg('Published x at y'), 0));
  });
});
