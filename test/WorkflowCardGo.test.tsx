import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkflowCard } from '../components/WorkflowView/WorkflowCard';
import type { WorkflowCard as Card } from '../utils/workflows';
import type { WorkflowGo, WorkflowState } from '../utils/workflowStage.js';

const card = (go: WorkflowGo | null, waitingOn: WorkflowState['waitingOn']): Card =>
  ({
    key: 'o/r#7',
    item: {
      itemId: 'PVTI_1',
      number: 7,
      title: 'Testissue',
      repo: 'o/r',
      labels: [{ name: 'mw:go', color: '000000' }],
      pullRequests: [],
    },
    node: { id: 'released', round: null },
    state: {
      stage: 'released',
      mode: 'default',
      waitingOn,
      reason: 'Wartet auf den Poll',
      since: null,
      go,
      briefingPath: null,
      sessionId: null,
      switches: { dynamic: true, delegate: false, review: false, model: null, effort: null },
      error: null,
    },
  }) as unknown as Card;

const renderCard = (c: Card, onGo = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <WorkflowCard
      card={c}
      expanded={false}
      moved={false}
      onToggle={() => {}}
      onGo={onGo}
      nav={{} as never}
    />
  );
  return onGo;
};

describe('WorkflowCard GO (#145)', () => {
  it('waiting on the poll: "Jetzt starten", two clicks send', async () => {
    const onGo = renderCard(card({ kind: 'poll' }, 'poll'));
    fireEvent.click(screen.getByRole('button', { name: /Jetzt starten/ }));
    expect(onGo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Wirklich/ }));
    await waitFor(() => expect(onGo).toHaveBeenCalledTimes(1));
  });

  it('briefing awaiting GO keeps "GO: Umsetzung"', () => {
    renderCard(card({ kind: 'build' }, 'hape'));
    expect(screen.getByRole('button', { name: /GO: Umsetzung/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Jetzt starten/ })).toBeNull();
  });

  it('agent working: no GO button', () => {
    renderCard(card(null, 'agent'));
    expect(screen.queryByRole('button', { name: /Jetzt starten|GO:/ })).toBeNull();
  });
});
