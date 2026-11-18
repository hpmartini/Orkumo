// The harness picker, `sessionHarness` and the composer's slash list are tested in
// @hpmartini/agents-ui; the server's settings schema stays here.
import { describe, it, expect } from 'vitest';
import { agentViewSettingsSchema } from '../server/schemas/agentViewSettings.js';

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
