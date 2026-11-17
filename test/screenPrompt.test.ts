import { describe, expect, it } from 'vitest';
import { screenPrompt } from '../utils/agentInput';

// Screen tails as Claude Code 2.1 draws them (shortened)
const PERMISSION = [
  '⏺ Bash(git push origin main)',
  '',
  ' Bash command',
  '   git push origin main',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  "   2. Yes, and don't ask again for git push commands",
  '   3. No, and tell Claude what to do differently (esc)',
  '',
  ' Esc to cancel · Tab to amend',
  '  plugin panel hidden · /panel to show',
  '  ✓ Update installed · Restart to apply',
].join('\n');

const ANSWER_WITH_QUESTIONS = [
  '⏺ Fertig. Zwei offene Fragen:',
  '  1. Soll ich mergen?',
  '  2. Release jetzt oder morgen?',
  '',
  '────────────────────────────',
  '❯ ',
  '────────────────────────────',
  '  plugin panel hidden · /panel to show',
  '  ✓ Update installed · Restart to apply',
].join('\n');

describe('question on the agent screen (yellow box)', () => {
  it('shows a permission or choice prompt, without Claude Code status lines', () => {
    const text = screenPrompt(PERMISSION);
    expect(text).toContain('Do you want to proceed?');
    expect(text).toContain('❯ 1. Yes');
    expect(text).not.toMatch(/plugin panel hidden|Update installed/);
  });

  it('a question picker (Enter to select) counts as well', () => {
    expect(
      screenPrompt(
        ' Which branch?\n ❯ 1. main\n   2. dev\n\n Enter to select · ↑/↓ to navigate · Esc to cancel'
      )
    ).toContain('Which branch?');
  });

  it('no box when the last answer only ends with open questions', () => {
    expect(screenPrompt(ANSWER_WITH_QUESTIONS)).toBeNull();
    expect(screenPrompt('')).toBeNull();
  });
});
