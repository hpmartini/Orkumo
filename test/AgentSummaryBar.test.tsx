import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentFilterBar, AgentSummaryBar } from '../components/AgentsView/AgentSummaryBar';
import { QUICK_FILTERS, type AgentQuickFilter } from '../utils/agentSessions';

const counts = { awaitingInput: 0, working: 2, completed: 1, failed: 0, cacheExpiring: 3 };

function summary(active: Set<AgentQuickFilter>, onToggle = vi.fn()) {
  return render(
    <AgentSummaryBar
      counts={counts}
      openPrs={0}
      runningServers={0}
      daemon={null}
      justCompleted={0}
      active={active}
      onToggle={onToggle}
      onOpenPrs={() => {}}
      onOpenServers={() => {}}
      panel={null}
    />
  );
}

describe('cache-expiring quick filter', () => {
  it('shows the count right after "completed" and toggles the filter', () => {
    const onToggle = vi.fn();
    const { rerender } = summary(new Set(), onToggle);
    const buttons = screen.getAllByRole('button').map((b) => b.textContent);
    expect(buttons.indexOf('3 cache expiring')).toBe(buttons.indexOf('1 completed') + 1);

    const toggle = screen.getByRole('button', { name: '3 cache expiring' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle.className).toContain('text-amber-300');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith('cache-expiring');

    rerender(
      <AgentSummaryBar
        counts={{ ...counts, cacheExpiring: 0 }}
        openPrs={0}
        runningServers={0}
        daemon={null}
        justCompleted={0}
        active={new Set(['cache-expiring'])}
        onToggle={onToggle}
        onOpenPrs={() => {}}
        onOpenServers={() => {}}
        panel={null}
      />
    );
    const pressed = screen.getByRole('button', { name: '0 cache expiring' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(pressed.className).toContain('text-gray-500');
  });

  it('has a chip with count in the filter bar that toggles the same key', () => {
    const onToggle = vi.fn();
    const chipCounts = Object.fromEntries(QUICK_FILTERS.map((f) => [f.key, 0])) as Record<
      AgentQuickFilter,
      number
    >;
    chipCounts['cache-expiring'] = 3;
    render(
      <AgentFilterBar
        sort={{ key: 'attention', dir: 'desc' }}
        onSort={() => {}}
        active={new Set()}
        onToggle={onToggle}
        chipCounts={chipCounts}
        shown={5}
        total={5}
        filtered={false}
        onClear={() => {}}
      />
    );
    const chip = screen.getByRole('button', { name: 'Cache expiring 3' });
    expect(chip).toHaveAttribute('title', 'Agents whose prompt cache expires within 10 minutes');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith('cache-expiring');
  });
});
