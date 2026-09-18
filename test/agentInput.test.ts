import { describe, it, expect } from 'vitest';
import {
  parseDispatchInput,
  parseFilter,
  applySessionFilter,
  computeSuggestions,
  extractNumberedChoices,
  stripAnsi,
} from '../utils/agentInput';
import type { AgentSession } from '../types';

const subagents = [{ name: 'code-reviewer' }, { name: 'tester' }];
const repos = [
  { name: 'web-app', path: '/home/dev/web-app' },
  { name: 'api', path: '/home/dev/api' },
];

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: 'abc12345',
    sessionId: 'abc12345-0000-0000-0000-000000000000',
    kind: 'background',
    cwd: '/home/dev/web-app',
    startedAt: 0,
    name: 'session',
    state: 'working',
    pinned: false,
    order: null,
    links: [],
    displayState: 'working',
    ...partial,
  };
}

describe('parseDispatchInput', () => {
  it('returns empty for blank input', () => {
    expect(parseDispatchInput('   ').kind).toBe('empty');
  });

  it('rejects prompts shorter than 4 characters', () => {
    expect(parseDispatchInput('fix').kind).toBe('too-short');
    expect(parseDispatchInput('fix the login bug').kind).toBe('dispatch');
  });

  it('detects shell jobs with a ! prefix', () => {
    const parsed = parseDispatchInput('! pytest -x');
    expect(parsed).toMatchObject({ kind: 'exec', command: 'pytest -x' });
    expect(parseDispatchInput('!').kind).toBe('too-short');
  });

  it('parses slash commands with arguments', () => {
    expect(parseDispatchInput('/model opus')).toMatchObject({
      kind: 'command',
      command: 'model',
      args: 'opus',
    });
    expect(parseDispatchInput('/resume')).toMatchObject({
      kind: 'command',
      command: 'resume',
      args: '',
    });
  });

  it('selects sessions by PR number or PR URL', () => {
    expect(parseDispatchInput('#1234')).toMatchObject({ kind: 'select-pr', number: 1234 });
    expect(parseDispatchInput('https://github.com/org/repo/pull/42')).toMatchObject({
      kind: 'select-pr',
      number: 42,
      url: 'https://github.com/org/repo/pull/42',
    });
  });

  it('treats a:, s: and plain URLs as filters', () => {
    expect(parseDispatchInput('a:code-reviewer')).toMatchObject({
      kind: 'filter',
      filter: { agent: 'code-reviewer' },
    });
    expect(parseDispatchInput('s:working')).toMatchObject({
      kind: 'filter',
      filter: { state: 'working' },
    });
    expect(parseDispatchInput('https://example.com/docs')).toMatchObject({
      kind: 'filter',
      filter: { url: 'https://example.com/docs' },
    });
  });

  it('runs a subagent when the first word matches', () => {
    const parsed = parseDispatchInput('code-reviewer address review comments on PR 1234', {
      subagents,
      repos,
    });
    expect(parsed).toMatchObject({
      kind: 'dispatch',
      agent: 'code-reviewer',
      prompt: 'address review comments on PR 1234',
    });
  });

  it('resolves @mentions to subagents or repositories, subagent wins', () => {
    const withRepo = parseDispatchInput('@web-app update the component library', {
      subagents,
      repos,
    });
    expect(withRepo).toMatchObject({
      kind: 'dispatch',
      repo: repos[0],
      agent: null,
      prompt: 'update the component library',
    });

    const withAgent = parseDispatchInput('please @tester write tests for the parser', {
      subagents,
      repos,
    });
    expect(withAgent).toMatchObject({
      kind: 'dispatch',
      agent: 'tester',
      prompt: 'please write tests for the parser',
    });

    const both = parseDispatchInput('@api @tester cover the routes', {
      subagents: [...subagents, { name: 'api' }],
      repos,
    });
    expect(both).toMatchObject({ agent: 'api', repo: null });
  });

  it('keeps unknown mentions inside the prompt', () => {
    const parsed = parseDispatchInput('ping @someone about the release', { subagents, repos });
    expect(parsed).toMatchObject({
      kind: 'dispatch',
      prompt: 'ping @someone about the release',
      agent: null,
      repo: null,
    });
  });
});

describe('filters', () => {
  const sessions = [
    session({
      id: 'one',
      name: 'fix login',
      state: 'working',
      displayState: 'working',
      agent: 'code-reviewer',
    }),
    session({ id: 'two', name: 'flaky test', state: 'blocked', displayState: 'needs-input' }),
    session({
      id: 'three',
      name: 'pr work',
      state: 'done',
      displayState: 'completed',
      links: [
        {
          id: 'l',
          href: 'https://github.com/o/r/pull/7',
          title: null,
          number: 7,
          provider: 'github',
          state: null,
        },
      ],
    }),
  ];

  it('filters by state with aliases', () => {
    expect(applySessionFilter(sessions, parseFilter('s:blocked')).map((s) => s.id)).toEqual([
      'two',
    ]);
    expect(applySessionFilter(sessions, parseFilter('s:needs-input')).map((s) => s.id)).toEqual([
      'two',
    ]);
    expect(applySessionFilter(sessions, parseFilter('s:completed')).map((s) => s.id)).toEqual([
      'three',
    ]);
  });

  it('filters by agent and PR number', () => {
    expect(applySessionFilter(sessions, parseFilter('a:code-reviewer')).map((s) => s.id)).toEqual([
      'one',
    ]);
    expect(applySessionFilter(sessions, { prNumber: 7 }).map((s) => s.id)).toEqual(['three']);
  });

  it('returns everything without a filter', () => {
    expect(applySessionFilter(sessions, null)).toHaveLength(3);
  });
});

describe('computeSuggestions', () => {
  const context = {
    subagents: [
      {
        name: 'code-reviewer',
        description: 'Reviews code',
        model: null,
        source: 'project' as const,
      },
    ],
    repos: [{ name: 'web-app', path: '/home/dev/web-app', source: 'repo' as const }],
    commands: [
      { name: 'resume', description: 'Resume' },
      { name: 'model', description: 'Model' },
    ],
  };

  it('suggests slash commands at the start', () => {
    const result = computeSuggestions('/re', 3, context);
    expect(result.suggestions.map((s) => s.label)).toEqual(['/resume']);
    expect(result.replaceStart).toBe(0);
  });

  it('suggests agents and repos for @mentions', () => {
    const result = computeSuggestions('fix @', 5, context);
    expect(result.suggestions.map((s) => s.label)).toEqual(['@code-reviewer', '@web-app']);
    expect(result.replaceStart).toBe(4);
  });

  it('browses subagents on empty input', () => {
    const result = computeSuggestions('', 0, context);
    expect(result.suggestions[0]).toMatchObject({ type: 'agent', insert: 'code-reviewer ' });
  });
});

describe('extractNumberedChoices', () => {
  it('finds a contiguous numbered list at the end of the output', () => {
    const output = [
      'Do you want to proceed?',
      '❯ 1. Yes',
      "  2. Yes, and don't ask again",
      '  3. No',
    ].join('\n');
    expect(extractNumberedChoices(output)).toEqual([
      { number: 1, label: 'Yes' },
      { number: 2, label: "Yes, and don't ask again" },
      { number: 3, label: 'No' },
    ]);
  });

  it('ignores lists that do not start at 1', () => {
    expect(extractNumberedChoices('2. second\n3. third')).toEqual([]);
  });

  it('strips ANSI sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m \x1b]0;title\x07done')).toBe('red done');
  });
});
