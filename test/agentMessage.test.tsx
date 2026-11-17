// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { agentMessage } from '../utils/chatEvents';
import { UserMessage } from '../components/AgentsView/Chat/ChatMessages';

describe('message from another agent (orkumo send)', () => {
  it('reads the sender line: id and name, id only, unknown sender, none', () => {
    expect(agentMessage('[von Agent omp-u3 „playmaker“ via orkumo send]\n\nbitte prüfen')).toEqual({
      id: 'omp-u3',
      name: 'playmaker',
      body: 'bitte prüfen',
    });
    expect(agentMessage('[von Agent abc-1 via orkumo send]\n\nhi')).toEqual({
      id: 'abc-1',
      name: null,
      body: 'hi',
    });
    expect(agentMessage('[via orkumo send, Absender unbekannt]\n\nhi')).toEqual({
      id: null,
      name: null,
      body: 'hi',
    });
    expect(agentMessage('mach [von Agent x via orkumo send] weiter')).toBeNull();
  });

  it("renders as the agent's bubble with a link to it, not as the user's", () => {
    const { container } = render(
      <MemoryRouter>
        <UserMessage text={'[von Agent omp-u3 „playmaker“ via orkumo send]\n\nbitte prüfen'} />
      </MemoryRouter>
    );
    expect(container.querySelector('[data-agent-message]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'playmaker' }).getAttribute('href')).toBe(
      '/agents?attach=omp-u3'
    );
    expect(screen.getByText('bitte prüfen')).toBeTruthy();
    expect(screen.queryByText(/von Agent/)).toBeNull();
  });

  it('own prompts stay the user bubble', () => {
    const { container } = render(<UserMessage text="eigener prompt" />);
    expect(container.querySelector('[data-agent-message]')).toBeNull();
    expect(screen.getByText('eigener prompt')).toBeTruthy();
  });
});
