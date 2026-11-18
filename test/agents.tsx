/**
 * agents-ui components rendered on their own (Chats route, browser pane, composer): a transport
 * with only the required groups, as stubs, and the parts of Orkumo's host a test passes in.
 */
import React from 'react';
import { vi } from 'vitest';
import {
  AgentsProvider,
  createLocalSettings,
  type AgentsHost,
  type AgentsTransport,
} from '@hpmartini/agents-ui';

const stubTransport = (): AgentsTransport => ({
  agents: {
    fetchAgents: vi.fn(),
    subscribeToAgents: vi.fn(() => () => {}),
    dispatchAgent: vi.fn(),
    stopAgent: vi.fn(),
  },
  settings: createLocalSettings(null),
  pty: { attach: vi.fn() },
});

export function withAgents(ui: React.ReactNode, host: Partial<AgentsHost> = {}) {
  return (
    <AgentsProvider
      transport={stubTransport()}
      host={{
        toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
        ...host,
      }}
    >
      {ui}
    </AgentsProvider>
  );
}
