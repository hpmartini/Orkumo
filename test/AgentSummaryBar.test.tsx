import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  AgentFilterBar,
  AgentSummaryBar,
  CHIPS_OPEN_KEY,
} from '../components/AgentsView/AgentSummaryBar';
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
    localStorage.removeItem(CHIPS_OPEN_KEY);
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
        linkEntries={[]}
        linkSelected={new Set()}
        onToggleLink={() => {}}
        query=""
        onQuery={() => {}}
      />
    );
    // Chips start collapsed
    expect(screen.queryByRole('button', { name: 'Cache expiring 3' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show filters' }));
    // Remembered for the next render
    expect(localStorage.getItem(CHIPS_OPEN_KEY)).toBe('1');
    const chip = screen.getByRole('button', { name: 'Cache expiring 3' });
    expect(chip).toHaveAttribute('title', 'Agents whose prompt cache expires within 10 minutes');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledWith('cache-expiring');
  });
});

const SearchBar = ({ onToggleLink = vi.fn() }: { onToggleLink?: (key: string) => void }) => {
  const [query, setQuery] = useState('');
  return (
    <AgentFilterBar
      sort={{ key: 'attention', dir: 'desc' }}
      onSort={() => {}}
      active={new Set()}
      onToggle={() => {}}
      chipCounts={
        Object.fromEntries(QUICK_FILTERS.map((f) => [f.key, 0])) as Record<AgentQuickFilter, number>
      }
      shown={2}
      total={2}
      filtered={false}
      onClear={() => {}}
      linkEntries={[
        { key: 'pr:u', kind: 'pr', label: '#5', title: 'Add login' },
        { key: 'issue:o/r#7', kind: 'issue', label: '#7', title: 'Fix crash' },
      ]}
      linkSelected={new Set(['issue:o/r#7'])}
      onToggleLink={onToggleLink}
      query={query}
      onQuery={setQuery}
    />
  );
};
const searchButton = () => screen.getByRole('button', { name: /^Search agents, PRs and issues/ });

describe('rail search (agents, PRs and issues in one)', () => {
  it('is a button; its field narrows the PR / issue list and the clicked entry toggles', () => {
    const onToggleLink = vi.fn();
    render(<SearchBar onToggleLink={onToggleLink} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.click(searchButton());
    expect(screen.getByRole('checkbox', { name: /Fix crash/ })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search agents' }), {
      target: { value: 'login' },
    });
    expect(screen.queryByRole('checkbox', { name: /Fix crash/ })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Add login/ }));
    expect(onToggleLink).toHaveBeenCalledWith('pr:u');
  });

  it('keeps the term after closing and shows it on the button', () => {
    render(<SearchBar />);
    fireEvent.click(searchButton());
    const field = screen.getByRole('searchbox', { name: 'Search agents' });
    fireEvent.change(field, { target: { value: 'login' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(searchButton()).toHaveTextContent('login');
  });

  it('opens with Ctrl+K (Cmd+K on macOS) and focuses the field', () => {
    render(<SearchBar />);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('searchbox', { name: 'Search agents' })).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('leaves Ctrl+K to the terminal, there it takes Ctrl+Shift+K', () => {
    render(<SearchBar />);
    const xterm = document.createElement('div');
    xterm.className = 'xterm';
    document.body.appendChild(xterm);
    fireEvent.keyDown(xterm, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('searchbox')).toBeNull();
    fireEvent.keyDown(xterm, { key: 'K', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('searchbox', { name: 'Search agents' })).toBeInTheDocument();
    xterm.remove();
  });
});
