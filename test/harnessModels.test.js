import { describe, it, expect } from 'vitest';
import { claudeModels, ompModels } from '../server/services/harnessModels.js';

describe('harness models for the picker', () => {
  it('reads omp models with their thinking levels', () => {
    const json = JSON.stringify({
      models: [
        {
          provider: 'anthropic',
          id: 'claude-fable-5',
          selector: 'anthropic/claude-fable-5',
          name: 'Claude Fable 5',
          thinking: ['low', 'high'],
        },
        { provider: 'ollama', id: 'qwen', selector: 'ollama/qwen', name: 'Qwen' },
        { provider: 'x' },
      ],
    });
    expect(ompModels(json)).toEqual([
      {
        id: 'anthropic/claude-fable-5',
        label: 'Claude Fable 5',
        group: 'anthropic',
        efforts: ['low', 'high'],
      },
      { id: 'ollama/qwen', label: 'Qwen', group: 'ollama', efforts: [] },
    ]);
  });

  it('reads Claude aliases and effort levels from --help', () => {
    const help = `  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session. Use an
                                        alias for the latest model (e.g.
                                        'fable', 'opus', or 'sonnet') or a
                                        model's full name.
  -n, --name <name>                     Set a display name`;
    const efforts = ['low', 'medium', 'high', 'xhigh', 'max'];
    expect(claudeModels(help)).toEqual(
      ['fable', 'opus', 'sonnet'].map((id) => ({ id, label: id, group: 'Claude', efforts }))
    );
  });
});
