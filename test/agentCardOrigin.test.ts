import { describe, it, expect } from 'vitest';
import {
  applyQuickFilters,
  cardSlots,
  isWorkflowSession,
  matchesQuickFilter,
  parseWorkflowName,
  workflowIssue,
  type SessionLookup,
} from '../utils/agentSessions';
import { agentViewSettingsSchema } from '../server/schemas/agentViewSettings.js';
import { DEFAULT_AGENT_CARD_FIELDS, type AgentSession } from '../types';

const WF_NAME = /^WF (\S+)#(\d+)(?: +(.*))?$/;

function session(partial: Partial<AgentSession>): AgentSession {
  return {
    id: Math.random().toString(36).slice(2, 10),
    sessionId: null,
    kind: 'background',
    cwd: '/home/dev/app',
    startedAt: 1000,
    name: 'session',
    state: 'done',
    pinned: false,
    order: null,
    links: [],
    displayState: 'completed',
    ...partial,
  };
}

describe('parseWorkflowName (#159, AC-2)', () => {
  it('strips the workflow prefix', () => {
    expect(parseWorkflowName('WF Orkumo#159 Darstellung Project-/Agent-Panel', WF_NAME)).toEqual({
      repo: 'Orkumo',
      number: 159,
      title: 'Darstellung Project-/Agent-Panel',
    });
  });

  it('keeps repos with dashes and dots', () => {
    expect(parseWorkflowName('WF martini-workflow.plugin#7 Fix it', WF_NAME)).toMatchObject({
      repo: 'martini-workflow.plugin',
      number: 7,
      title: 'Fix it',
    });
  });

  it('falls back to the full name when no title follows the prefix', () => {
    expect(parseWorkflowName('WF Orkumo#12', WF_NAME)?.title).toBe('WF Orkumo#12');
    expect(parseWorkflowName('WF Orkumo#12   ', WF_NAME)?.title).toBe('WF Orkumo#12');
  });

  it('leaves every other name alone', () => {
    for (const name of [
      'browser-panel externe urls',
      'MAC Orkumo#1 typo',
      'macc Orkumo#1 lowercase',
      'Fix WF Orkumo#1 later',
      'WF Orkumo#abc title',
      '',
      null,
      undefined,
    ]) {
      expect(parseWorkflowName(name, WF_NAME)).toBeNull();
    }
  });
});

describe('workflow origin (#159, AC-1)', () => {
  const byPrefix = session({ id: 'a', name: 'WF Orkumo#37 Landingpage' });
  const byLink = session({ id: 'b', name: 'renamed by hand' });
  const local = session({ id: 'c', name: 'package.json build install' });
  const lookup: SessionLookup = {
    workflowIssues: new Map([['b', 'hpmartini/Orkumo#140']]),
    workflowName: WF_NAME,
  };

  it('detects workflow agents by name prefix or workflow link', () => {
    expect(isWorkflowSession(byPrefix, lookup)).toBe(true);
    expect(isWorkflowSession(byLink, lookup)).toBe(true);
    expect(isWorkflowSession(byLink)).toBe(false);
    expect(isWorkflowSession(local, lookup)).toBe(false);
  });

  it('local and workflow chips are complementary', () => {
    for (const s of [byPrefix, byLink, local]) {
      expect(matchesQuickFilter('local', s, lookup)).toBe(
        !matchesQuickFilter('workflow', s, lookup)
      );
    }
  });

  it('no or both origin chips show everything, one chip shows its kind', () => {
    const all = [byPrefix, byLink, local];
    const ids = (active: Parameters<typeof applyQuickFilters>[1]) =>
      applyQuickFilters(all, active, lookup).map((s) => s.id);
    expect(ids(new Set())).toEqual(['a', 'b', 'c']);
    expect(ids(new Set(['local', 'workflow']))).toEqual(['a', 'b', 'c']);
    expect(ids(new Set(['workflow']))).toEqual(['a', 'b']);
    expect(ids(new Set(['local']))).toEqual(['c']);
  });

  it('origin chips AND-combine with state chips', () => {
    const working = session({
      id: 'w',
      name: 'WF Orkumo#1 x',
      state: 'working',
      displayState: 'working',
    });
    const all = [working, byPrefix, local];
    const ids = applyQuickFilters(all, new Set(['workflow', 'working', 'completed']), lookup).map(
      (s) => s.id
    );
    expect(ids).toEqual(['w', 'a']);
    expect(applyQuickFilters(all, new Set(['local', 'working']), lookup)).toEqual([]);
  });

  it('resolves the issue key: workflow link, linked issues, repo slug', () => {
    expect(workflowIssue(byLink, lookup)).toEqual({ key: 'hpmartini/Orkumo#140', number: 140 });
    expect(
      workflowIssue(byPrefix, { workflowName: WF_NAME }, ['other/x#1', 'hpmartini/orkumo#37'])
    ).toEqual({
      key: 'hpmartini/orkumo#37',
      number: 37,
    });
    const withSlug: SessionLookup = {
      workflowName: WF_NAME,
      contexts: {
        a: { repo: { slug: 'hpmartini/Orkumo' } } as never,
      },
    };
    expect(workflowIssue(byPrefix, withSlug)).toEqual({ key: 'hpmartini/Orkumo#37', number: 37 });
    expect(workflowIssue(byPrefix, { workflowName: WF_NAME })).toEqual({ key: null, number: 37 });
    // no provider: names are never matched
    expect(workflowIssue(byPrefix)).toBeNull();
    expect(isWorkflowSession(byPrefix)).toBe(false);
    expect(workflowIssue(local, lookup)).toBeNull();
  });
});

describe('card fields (#159, AC-7)', () => {
  it('sorts elements into slots and drops empty ones', () => {
    const slots = cardSlots(
      { ...DEFAULT_AGENT_CARD_FIELDS, servers: 'row2', metrics: 'hidden' },
      {
        issue: 'I',
        pr: false,
        project: 'P',
        branch: 'B',
        git: null,
        metrics: 'M',
        status: '',
        links: [],
        servers: 'S',
        subagents: undefined,
      }
    );
    expect(slots.left).toEqual(['I']);
    expect(slots.row2).toEqual(['P', 'B', 'S']);
    expect(slots.hidden).toEqual(['M']);
    expect(slots.details).toEqual([]);
    expect(slots.row4).toEqual([]);
  });

  it('missing keys fall back to the default slot', () => {
    const slots = cardSlots({ pr: 'title' }, {
      issue: 'I',
      pr: 'R',
      project: null,
      branch: null,
      git: null,
      metrics: null,
      status: null,
      links: ['L'],
      servers: null,
      subagents: null,
    } as never);
    expect(slots.left).toEqual(['I']);
    expect(slots.title).toEqual(['R']);
    expect(slots.details).toEqual([['L']]);
  });

  it('settings schema accepts partial and absent cardFields, rejects unknown keys and slots', () => {
    expect(agentViewSettingsSchema.safeParse({ cardDensity: 'compact' }).success).toBe(true);
    expect(agentViewSettingsSchema.safeParse({ cardFields: { pr: 'row3' } }).success).toBe(true);
    expect(
      agentViewSettingsSchema.safeParse({ cardFields: DEFAULT_AGENT_CARD_FIELDS }).success
    ).toBe(true);
    expect(agentViewSettingsSchema.safeParse({ cardFields: { pr: 'top' } }).success).toBe(false);
    expect(agentViewSettingsSchema.safeParse({ cardFields: { evil: 'row2' } }).success).toBe(false);
  });
});
