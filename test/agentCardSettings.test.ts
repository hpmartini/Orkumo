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

const base = {
  hasDetails: true,
  pinned: false,
  hovered: false,
  anyHovered: false,
  selectedBy: null as 'click' | 'keyboard' | null,
};

describe('cardDetailsVisible (#135, #181)', () => {
  it('hover mode: the hovered card; a keyboard selection only while nothing is hovered; never a click', () => {
    expect(cardDetailsVisible('hover', base)).toBe(false);
    expect(cardDetailsVisible('hover', { ...base, hovered: true, anyHovered: true })).toBe(true);
    expect(cardDetailsVisible('hover', { ...base, selectedBy: 'keyboard' })).toBe(true);
    expect(cardDetailsVisible('hover', { ...base, selectedBy: 'keyboard', anyHovered: true })).toBe(
      false
    );
    expect(cardDetailsVisible('hover', { ...base, selectedBy: 'click' })).toBe(false);
  });

  it('click mode: the selected card, hover never', () => {
    expect(cardDetailsVisible('click', { ...base, hovered: true, anyHovered: true })).toBe(false);
    expect(cardDetailsVisible('click', { ...base, selectedBy: 'click' })).toBe(true);
    expect(cardDetailsVisible('click', { ...base, selectedBy: 'keyboard' })).toBe(true);
    expect(cardDetailsVisible('click', { ...base, pinned: true })).toBe(true);
  });

  it('always mode shows details, every mode hides a card without details', () => {
    expect(cardDetailsVisible('always', base)).toBe(true);
    for (const mode of ['hover', 'click', 'always'] as const) {
      expect(
        cardDetailsVisible(mode, {
          ...base,
          hasDetails: false,
          pinned: true,
          hovered: true,
          selectedBy: 'click',
        })
      ).toBe(false);
    }
  });

  // AC-3: for every list of 3 cards (selection, how it was made, hovered card) at most one opens transiently
  it('hover and click open at most one unpinned card in every state', () => {
    const ids = [0, 1, 2];
    for (const mode of ['hover', 'click'] as const)
      for (const selected of [null, ...ids])
        for (const by of ['click', 'keyboard'] as const)
          for (const hovered of [null, ...ids]) {
            const open = ids.filter((i) =>
              cardDetailsVisible(mode, {
                hasDetails: true,
                pinned: false,
                hovered: hovered === i,
                anyHovered: hovered !== null,
                selectedBy: selected === i ? by : null,
              })
            );
            expect(open.length, `${mode} sel=${selected}/${by} hov=${hovered}`).toBeLessThanOrEqual(
              1
            );
          }
  });
});

describe('agent card settings defaults and persistence (#135)', () => {
  it('client and server defaults agree: click (#181) + comfortable', async () => {
    const { DEFAULT_AGENT_VIEW_SETTINGS: server } =
      await import('../server/services/settingsService.js');
    expect(DEFAULT_AGENT_VIEW_SETTINGS.cardDetails).toBe('click');
    expect(DEFAULT_AGENT_VIEW_SETTINGS.cardDensity).toBe('comfortable');
    expect(server.cardDetails).toBe(DEFAULT_AGENT_VIEW_SETTINGS.cardDetails);
    expect(server.cardDensity).toBe(DEFAULT_AGENT_VIEW_SETTINGS.cardDensity);
  });

  it('cardFields (#159): client and server defaults agree, old files get them, updates merge', async () => {
    const { DEFAULT_AGENT_VIEW_SETTINGS: server, settingsService } =
      await import('../server/services/settingsService.js');
    expect(server.cardFields).toEqual(DEFAULT_AGENT_VIEW_SETTINGS.cardFields);
    stored = JSON.stringify({ agentView: { grouping: 'state' }, version: 1 });
    expect(settingsService.getAgentViewSettings().cardFields).toEqual(
      DEFAULT_AGENT_VIEW_SETTINGS.cardFields
    );
    settingsService.updateAgentViewSettings({ cardFields: { pr: 'row3' } });
    expect(settingsService.getAgentViewSettings().cardFields).toEqual({
      ...DEFAULT_AGENT_VIEW_SETTINGS.cardFields,
      pr: 'row3',
    });
  });

  it('existing settings files without the new keys get the defaults; updates persist', async () => {
    stored = JSON.stringify({ agentView: { grouping: 'state' }, version: 1 });
    const { settingsService } = await import('../server/services/settingsService.js');
    expect(settingsService.getAgentViewSettings()).toMatchObject({
      grouping: 'state',
      cardDetails: 'click',
      cardDensity: 'comfortable',
    });
    // #181: a saved `hover` stays, only unset files get the new default
    stored = JSON.stringify({ agentView: { cardDetails: 'hover' }, version: 1 });
    expect(settingsService.getAgentViewSettings().cardDetails).toBe('hover');
    settingsService.updateAgentViewSettings({ cardDetails: 'always', cardDensity: 'compact' });
    expect(JSON.parse(stored).agentView).toMatchObject({
      cardDetails: 'always',
      cardDensity: 'compact',
    });
    expect(settingsService.getAgentViewSettings().cardDetails).toBe('always');
  });
});

describe('agent view settings schema (#135)', () => {
  it('accepts the card options and rejects unknown values', async () => {
    const { agentViewSettingsSchema } = await import('../server/schemas/agentViewSettings.js');
    for (const cardDetails of ['hover', 'click', 'always']) {
      expect(agentViewSettingsSchema.safeParse({ cardDetails }).success).toBe(true);
    }
    for (const cardDensity of ['comfortable', 'compact']) {
      expect(agentViewSettingsSchema.safeParse({ cardDensity }).success).toBe(true);
    }
    expect(agentViewSettingsSchema.safeParse({ cardDetails: 'bogus' }).success).toBe(false);
    expect(agentViewSettingsSchema.safeParse({ cardDensity: 'roomy' }).success).toBe(false);
  });
});
