import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatPane } from '../../../components/AgentsView/Chat/ChatPane';
import type { AgentSession } from '../../../types';

const pane = {
  id: 'pane-1',
  name: 'demo',
  cwd: '/tmp/demo',
  kind: 'claude',
} as unknown as AgentSession;
// The agent is mid-turn: busy, so a prompt typed now queues
const agent = { ...pane, displayState: 'working', status: 'running' } as unknown as AgentSession;
const noop = () => {};

createRoot(document.getElementById('root')!).render(
  <div style={{ height: '100vh', maxWidth: 760 }}>
    <ChatPane
      pane={pane}
      agent={agent}
      sessionId="11111111-2222-3333-4444-555555555555"
      active
      focused
      submitKey="enter"
      showSteps={false}
      onToggleSteps={noop}
      onFocus={noop}
      onClose={noop}
      onShowTerminal={noop}
    />
  </div>
);
