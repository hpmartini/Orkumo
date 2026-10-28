import { describe, it, expect, vi } from 'vitest';
import { cardDetailsVisible } from '../utils/agentSessions';
import { DEFAULT_AGENT_VIEW_SETTINGS } from '../types';

let stored = '{}';
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => stored),
    writeFileSync: vi.fn((_path: string, data: string) => {
      stored = data;
    }),
  },
}));

const base = { hasDetails: true, pinned: false, hovered: false, focused: false };

describe('cardDetailsVisible (#135)', () => {
  it('hover mode: shows on hover or keyboard focus, hides otherwise', () => {
    expect(cardDetailsVisible('hover', base)).toBe(false);
    expect(cardDetailsVisible('hover', { ...base, hovered: true })).toBe(true);
    expect(cardDetailsVisible('hover', { ...base, focused: true })).toBe(true);
  });

  it('click mode: only the pinned (chevron) state counts', () => {
    expect(cardDetailsVisible('click', { ...base, hovered: true, focused: true })).toBe(false);
    expect(cardDetailsVisible('click', { ...base, pinned: true })).toBe(true);
  });

  it('always mode shows details, every mode hides a card without details', () => {
    expect(cardDetailsVisible('always', base)).toBe(true);
    for (const mode of ['hover', 'click', 'always'] as const) {
      expect(
        cardDetailsVisible(mode, { hasDetails: false, pinned: true, hovered: true, focused: true })
      ).toBe(false);
    }
  });
});

describe('agent card settings defaults and persistence (#135)', () => {
  it('client and server defaults agree: hover + comfortable', async () => {
    const { DEFAULT_AGENT_VIEW_SETTINGS: server } =
      await import('../server/services/settingsService.js');
    expect(DEFAULT_AGENT_VIEW_SETTINGS.cardDetails).toBe('hover');
    expect(DEFAULT_AGENT_VIEW_SETTINGS.cardDensity).toBe('comfortable');
    expect(server.cardDetails).toBe(DEFAULT_AGENT_VIEW_SETTINGS.cardDetails);
    expect(server.cardDensity).toBe(DEFAULT_AGENT_VIEW_SETTINGS.cardDensity);
  });

  it('existing settings files without the new keys get the defaults; updates persist', async () => {
    stored = JSON.stringify({ agentView: { grouping: 'state' }, version: 1 });
    const { settingsService } = await import('../server/services/settingsService.js');
    expect(settingsService.getAgentViewSettings()).toMatchObject({
      grouping: 'state',
      cardDetails: 'hover',
      cardDensity: 'comfortable',
    });
    settingsService.updateAgentViewSettings({ cardDetails: 'always', cardDensity: 'compact' });
    expect(JSON.parse(stored).agentView).toMatchObject({
      cardDetails: 'always',
      cardDensity: 'compact',
    });
    expect(settingsService.getAgentViewSettings().cardDetails).toBe('always');
  });
});
