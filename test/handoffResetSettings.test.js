// Handoff + Reset threshold: the agent view setting `handoffResetTokens` (default 150000, min 1000)
import { describe, it, expect } from 'vitest';
import { agentViewSettingsSchema } from '../server/schemas/agentViewSettings.js';
import { DEFAULT_AGENT_VIEW_SETTINGS } from '../server/services/settingsService.js';

describe('agentView.handoffResetTokens', () => {
  it('defaults to 150000', () => {
    expect(DEFAULT_AGENT_VIEW_SETTINGS.handoffResetTokens).toBe(150000);
  });

  it('is accepted from 1000 up and rejected below, fractional or as text', () => {
    const ok = (handoffResetTokens) =>
      agentViewSettingsSchema.safeParse({ handoffResetTokens }).success;
    expect(ok(150000)).toBe(true);
    expect(ok(1000)).toBe(true);
    expect(ok(999)).toBe(false);
    expect(ok(1500.5)).toBe(false);
    expect(ok('150000')).toBe(false);
    expect(ok(10_000_001)).toBe(false);
  });
});
