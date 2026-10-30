import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import type { BoardItem, WorkflowRunInfo } from '../types';
import { buildWorkflowCards } from '../utils/workflows';
import { WorkflowCard } from '../components/WorkflowView/WorkflowCard';
import type { WorkflowNav } from '../components/WorkflowView/WorkflowDetails';

vi.mock('../services/boardApi', () => ({
  fetchWorkflowDetails: vi.fn(() => Promise.resolve({ docs: [], screenshots: [], phases: [] })),
}));

const item: BoardItem = {
  itemId: 'PVTI_7',
  type: 'Issue',
  issueId: 'I_7',
  number: 7,
  title: 'Karte sieben',
  url: 'https://github.com/o/r/issues/7',
  repo: 'o/r',
  state: 'OPEN',
  stateReason: null,
  statusOptionId: 'prog',
  labels: [{ name: 'mw:go', color: 'aaaaaa' }],
  milestone: null,
  assignees: ['hpmartini'],
  parent: null,
  subIssues: { total: 0, completed: 0 },
  pullRequests: [],
  mwBoardSessions: [],
  mwMarkers: [
    { kind: 'start', attrs: { session: 's' }, at: '' },
    { kind: 'briefed', attrs: { path: 'b.md' }, at: '' },
  ],
  updatedAt: '2026-10-01T00:00:00Z',
  closedAt: null,
} as BoardItem;
const run: WorkflowRunInfo = {
  runId: 'run-42',
  repoPath: '/tmp/r',
  mode: 'orchestrate',
  phases: [{ phase: 'build', result: 'passed', at: '2026-10-01T00:00:00Z' }],
  pendingApproval: null,
  runDir: '/tmp/r/run-42',
} as WorkflowRunInfo;
const [card] = buildWorkflowCards(
  [item],
  [{ id: 'prog', name: 'In Progress', color: 'BLUE' }],
  { 'o/r#7': run },
  Date.parse('2026-10-02T00:00:00Z')
);

function setup(nav: Partial<WorkflowNav> = {}) {
  const onToggle = vi.fn();
  const navImpl: WorkflowNav = {
    openAgent: vi.fn(),
    openCode: vi.fn(),
    openDoc: vi.fn(),
    ...nav,
  };
  // Real expand state, so the details render after a toggle
  const Host = () => {
    const [open, setOpen] = useState(false);
    return (
      <WorkflowCard
        card={card}
        expanded={open}
        moved={false}
        onToggle={() => {
          onToggle();
          setOpen((o) => !o);
        }}
        onGo={() => Promise.resolve()}
        nav={navImpl}
      />
    );
  };
  render(<Host />);
  return { onToggle, nav: navImpl };
}

const toggleButton = () => screen.getByRole('button', { name: /Details zu/ });

describe('WorkflowCard', () => {
  beforeEach(cleanup);

  it('AC-1: a click anywhere on the card toggles the details', () => {
    const { onToggle } = setup();
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByText('Karte sieben'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Springen zu')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Ablauf'));
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('AC-1: Enter and Space on the focused card expand and collapse', async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();
    await user.tab();
    expect(screen.getByLabelText(/^o\/r#7: Karte sieben/)).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(toggleButton()).toHaveAttribute('aria-expanded', 'false');
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('AC-1: Enter on an inner button does not toggle the card', async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();
    screen.getByRole('button', { name: /GO: Umsetzung/ }).focus();
    await user.keyboard('{Enter}');
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('AC-2: GO, Agent, Issue and Code clicks do not toggle', () => {
    const { onToggle, nav } = setup();
    fireEvent.click(screen.getByText('Karte sieben'));
    onToggle.mockClear();
    expect(card.state.go).toEqual({ kind: 'build' });
    fireEvent.click(screen.getByRole('button', { name: /GO: Umsetzung/ }));
    fireEvent.click(screen.getByRole('button', { name: /Agent/ }));
    fireEvent.click(screen.getByRole('link', { name: /Issue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Code/ }));
    expect(onToggle).not.toHaveBeenCalled();
    expect(nav.openCode).toHaveBeenCalledTimes(1);
  });

  it('AC-3: expanded details show stage, agent, run, assignees and labels', () => {
    setup();
    fireEvent.click(screen.getByText('Karte sieben'));
    const stand = screen.getByText('Stand').closest('section')!;
    const s = within(stand);
    expect(s.getByText('Stufe')).toBeInTheDocument();
    expect(s.getByText(card.state.reason)).toBeInTheDocument();
    expect(s.getByText('keine laufende Session')).toBeInTheDocument();
    expect(s.getByText('run-42 · 1 Schritte')).toBeInTheDocument();
    expect(s.getByText('hpmartini')).toBeInTheDocument();
    expect(s.getByText('mw:go')).toBeInTheDocument();
  });

  it('AC-4: Code shows a spinner and stays disabled until the jump resolves', async () => {
    let done!: () => void;
    const openCode = vi.fn(() => new Promise<void>((r) => (done = r)));
    setup({ openCode });
    fireEvent.click(screen.getByText('Karte sieben'));
    fireEvent.click(screen.getByRole('button', { name: /Code/ }));
    const busy = screen.getByRole('button', { name: /Öffne/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(openCode).toHaveBeenCalledTimes(1);
    done();
    expect(await screen.findByRole('button', { name: /Code/ })).toBeEnabled();
  });
});
