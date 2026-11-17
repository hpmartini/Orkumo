import { describe, it, expect } from 'vitest';
import {
  effortColumns,
  matrixRows,
  pickLabel,
  switchCommands,
  isCurrentModel,
} from '../utils/modelMatrix';

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

describe('switching a running session', () => {
  it('types one command per change, in each CLI’s own words', () => {
    expect(switchCommands('claude', 'opus', 'high')).toEqual(['/model opus', '/effort high']);
    expect(switchCommands('omp', 'anthropic/claude-fable-5', '')).toEqual([
      '/switch anthropic/claude-fable-5',
    ]);
    expect(switchCommands('omp', '', 'xhigh')).toEqual(['/effort xhigh']);
    expect(switchCommands('claude', '', '')).toEqual([]);
  });
});

describe('isCurrentModel', () => {
  it('matches the alias inside a full model id, not a prefix', () => {
    expect(isCurrentModel('opus', 'claude-opus-5-5')).toBe(true);
    expect(isCurrentModel('opus', 'anthropic/claude-opus-5-5')).toBe(true);
    expect(isCurrentModel('claude-opus-5-5', 'claude-opus-5-5')).toBe(true);
    expect(isCurrentModel('op', 'claude-opus-5-5')).toBe(false);
    expect(isCurrentModel('sonnet', 'claude-opus-5-5')).toBe(false);
    expect(isCurrentModel('opus', null)).toBe(false);
  });
});
