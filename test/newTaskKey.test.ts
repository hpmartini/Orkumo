import { describe, it, expect } from 'vitest';
import { isNewTaskKey } from '../components/AgentsView/AgentsView';

const key = (init: Partial<KeyboardEvent>, target?: HTMLElement) => {
  const e = new KeyboardEvent('keydown', { code: 'KeyN', key: 'n', ...init });
  if (target) Object.defineProperty(e, 'target', { value: target });
  return e;
};

// jsdom reports no Mac platform: the Ctrl+N branch
describe('new task shortcut', () => {
  it('Ctrl+N opens a new task, Alt+N no longer does (Alt+N types ~ on a Mac)', () => {
    expect(isNewTaskKey(key({ ctrlKey: true }))).toBe(true);
    expect(isNewTaskKey(key({ altKey: true }))).toBe(false);
    expect(isNewTaskKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isNewTaskKey(key({}))).toBe(false);
  });

  it('leaves Ctrl+N to the shell inside a terminal', () => {
    const term = document.createElement('div');
    term.className = 'xterm';
    const inner = term.appendChild(document.createElement('textarea'));
    expect(isNewTaskKey(key({ ctrlKey: true }, inner))).toBe(false);
  });
});
