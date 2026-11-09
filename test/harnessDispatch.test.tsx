import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { DispatchInput } from '../components/AgentsView/DispatchInput';
import { agentViewSettingsSchema } from '../server/schemas/agentViewSettings.js';
import { resumableSessionId, sessionHarness } from '../utils/agentSessions';
import type { AgentHarness, AgentSession } from '../types';

function renderInput(
  harness: AgentHarness | undefined,
  extra: Partial<React.ComponentProps<typeof DispatchInput>> = {}
) {
  const onHarnessChange = vi.fn();
  render(
    <DispatchInput
      value="@"
      onChange={() => {}}
      onSubmit={() => {}}
      onEscape={() => {}}
      onOpenEditor={() => {}}
      onPickDirectory={() => {}}
      targetCwd="/p"
      hint={null}
      subagents={[{ name: 'reviewer', description: 'd', model: null, source: 'project' }]}
      repos={[]}
      commands={[]}
      inputRef={React.createRef()}
      harness={harness}
      onHarnessChange={onHarnessChange}
      harnessInstalled={{ opencode: false, codex: true }}
      {...extra}
    />
  );
  return { onHarnessChange };
}

describe('harness picker (#195, AC-5, AC-7)', () => {
  it('shows the preset harness and reports a change', () => {
    const { onHarnessChange } = renderInput('codex');
    const select = screen.getByRole('combobox', { name: /Harness/ });
    expect(select).toHaveProperty('value', 'codex');
    fireEvent.change(select, { target: { value: 'pi' } });
    expect(onHarnessChange).toHaveBeenCalledWith('pi');
  });

  it('marks a missing CLI as not installed and disables it', () => {
    renderInput('claude');
    const option = screen.getByRole('option', { name: 'OpenCode (not installed)' });
    expect(option).toHaveProperty('disabled', true);
    expect(screen.getByRole('option', { name: 'Codex' })).toHaveProperty('disabled', false);
  });

  it('turns off the Claude-only parts for another harness', () => {
    renderInput('claude');
    expect(screen.getByText('Dispatch and attach')).toBeTruthy();
    expect(screen.getByText(/@agent · @repo/)).toBeTruthy();

    cleanup();
    renderInput('omp');
    expect(screen.queryByText('Dispatch and attach')).toBeNull();
    expect(screen.queryByText(/@agent · @repo/)).toBeNull();
    expect(screen.getByText(/Runs interactively in a terminal pane/)).toBeTruthy();
    expect(screen.getByText('Start agent')).toBeTruthy();
  });

  it('has no picker for chats', () => {
    renderInput(undefined, { variant: 'chat' });
    expect(screen.queryByRole('combobox', { name: /Harness/ })).toBeNull();
  });
});

describe('default harness setting (#195, AC-2)', () => {
  it('accepts exactly the five harnesses', () => {
    for (const harness of ['claude', 'omp', 'opencode', 'codex', 'pi']) {
      expect(agentViewSettingsSchema.safeParse({ dispatch: { harness } }).success).toBe(true);
    }
    for (const harness of ['bash', 'Codex', '', 'claude ', 1]) {
      expect(agentViewSettingsSchema.safeParse({ dispatch: { harness } }).success).toBe(false);
    }
    expect(agentViewSettingsSchema.safeParse({ cardFields: { harness: 'title' } }).success).toBe(
      true
    );
  });
});

describe('sessionHarness / resumableSessionId (#195)', () => {
  const base = {
    id: 'i',
    sessionId: null,
    kind: 'interactive',
    cwd: '/p',
    startedAt: 0,
    name: 'n',
    state: null,
    pinned: false,
    order: null,
    links: [],
    displayState: 'idle',
  } as AgentSession;

  it('derives the harness from the PTY command', () => {
    expect(sessionHarness(base)).toBe('claude');
    expect(sessionHarness({ ...base, ptyCommand: 'pi' })).toBe('pi');
  });

  it('never offers another harness for `claude --resume`', () => {
    expect(resumableSessionId({ ...base, ptyArgs: ['--session-id', 'abc'] })).toBe('abc');
    expect(resumableSessionId({ ...base, ptyCommand: 'codex', ptyArgs: ['--', 'x'] })).toBeNull();
  });
});
