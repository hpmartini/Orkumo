// Board header agent filter: long agent names truncate inside their pill, full name as tooltip
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AgentFilter } from '../components/BoardView/BoardView';

const long = 'feature-agent-with-a-very-long-session-name-that-would-push-the-header-wide';

describe('AgentFilter pills', () => {
  it('truncates a long agent name and keeps the full name as tooltip and accessible name', () => {
    render(
      <AgentFilter
        value=""
        onChange={vi.fn()}
        options={[
          { value: '', label: 'All agents' },
          { value: 'job-1', label: long },
        ]}
      />
    );
    const row = screen.getByRole('radiogroup', { name: 'Filter by agent' });
    // the row may wrap and shrink with the header instead of pushing past it
    expect(row.className).not.toMatch(/flex-nowrap|shrink-0/);
    expect(row.className).toMatch(/\[&>button\]:truncate/);
    expect(row.className).toMatch(/\[&>button\]:max-w-/);
    const pill = screen.getByRole('radio', { name: long });
    expect(pill).toHaveAttribute('title', long);
    expect(pill).toHaveTextContent(long);
  });

  it('adds no hint in menu mode, where a hint would render as trailing text', () => {
    render(
      <AgentFilter
        value=""
        onChange={vi.fn()}
        options={[
          { value: '', label: 'All agents' },
          { value: 'a', label: 'one' },
          { value: 'b', label: 'two' },
          { value: 'c', label: long },
        ]}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Filter by agent/ }));
    expect(screen.getByRole('option', { name: long })).toHaveTextContent(new RegExp(`^${long}$`));
  });
});
