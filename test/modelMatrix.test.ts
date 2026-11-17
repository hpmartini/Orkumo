import { describe, it, expect } from 'vitest';
import { effortColumns, matrixRows, pickLabel } from '../utils/modelMatrix';

const models = [
  {
    id: 'anthropic/claude-fable-5',
    label: 'Claude Fable 5',
    group: 'anthropic',
    efforts: ['max', 'low', 'high'],
  },
  { id: 'minimax/m3', label: 'MiniMax M3', group: 'minimax', efforts: ['minimal', 'turbo'] },
];

describe('model × effort matrix', () => {
  it('orders effort columns low to high, unknown levels last', () => {
    expect(effortColumns(models)).toEqual(['minimal', 'low', 'high', 'max', 'turbo']);
  });

  it('adds aliases the CLI does not list and filters on id, label and provider', () => {
    const claude = [{ id: 'opus', label: 'opus', group: 'Claude', efforts: ['low', 'high'] }];
    expect(matrixRows(claude, ['opus', 'haiku'], '').map((m) => [m.id, m.efforts])).toEqual([
      ['opus', ['low', 'high']],
      ['haiku', ['low', 'high']],
    ]);
    expect(matrixRows(models, [], 'MINIMAX').map((m) => m.id)).toEqual(['minimax/m3']);
    expect(matrixRows(models, [], 'fable 5').map((m) => m.id)).toEqual([
      'anthropic/claude-fable-5',
    ]);
  });

  it('labels the button with model and effort, naming the default', () => {
    expect(pickLabel('opus', 'high')).toBe('opus · high');
    expect(pickLabel('', '', 'sonnet')).toBe('default (sonnet)');
    expect(pickLabel('', 'low')).toBe('default · low');
  });
});
