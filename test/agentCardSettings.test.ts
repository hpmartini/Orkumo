import { describe, it, expect, vi } from 'vitest';
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

describe('agent card settings defaults and persistence (#135)', () => {
  it('client and server defaults agree: comfortable', async () => {
    const { DEFAULT_AGENT_VIEW_SETTINGS: server } =
      await import('../server/services/settingsService.js');
    expect(DEFAULT_AGENT_VIEW_SETTINGS.cardDensity).toBe('comfortable');
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
      cardDensity: 'comfortable',
    });
    // The removed card-details setting and its #242 marker load fine and are not written back
    stored = JSON.stringify({
      agentView: { cardDetails: 'hover', cardDetailsMigrated: true },
      version: 1,
    });
    expect(settingsService.getAgentViewSettings()).not.toHaveProperty('cardDetails');
    settingsService.updateAgentViewSettings({ cardDensity: 'compact' });
    const onDisk = JSON.parse(stored).agentView;
    expect(onDisk).toMatchObject({ cardDensity: 'compact' });
    expect(onDisk).not.toHaveProperty('cardDetails');
    expect(onDisk).not.toHaveProperty('cardDetailsMigrated');
  });
});

describe('agent view settings schema (#135)', () => {
  it('accepts the card options and rejects unknown values', async () => {
    const { agentViewSettingsSchema } = await import('../server/schemas/agentViewSettings.js');
    for (const cardDensity of ['comfortable', 'compact']) {
      expect(agentViewSettingsSchema.safeParse({ cardDensity }).success).toBe(true);
    }
    expect(agentViewSettingsSchema.safeParse({ cardDensity: 'roomy' }).success).toBe(false);
  });
});
