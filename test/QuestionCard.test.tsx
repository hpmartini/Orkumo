import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QuestionCard } from '../components/AgentsView/Chat/QuestionCard';
import { parseAgentDialog, type AgentDialog } from '../utils/agentDialog';

const dialog = (name: string): AgentDialog => {
  const text = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'agentDialogs', `${name}.txt`),
    'utf8'
  );
  const d = parseAgentDialog(text);
  if (!d) throw new Error(name);
  return d;
};

const card = (name: string, props: { sent?: boolean; disabled?: boolean } = {}) => {
  const onAnswer = vi.fn();
  render(<QuestionCard dialog={dialog(name)} onAnswer={onAnswer} {...props} />);
  return onAnswer;
};

describe('QuestionCard', () => {
  it('a question: options with their description, a click answers', () => {
    const onAnswer = card('claude-question-single');
    expect(screen.getByText('Wohin deployen?')).toBeTruthy();
    expect(screen.getByText('Testumgebung')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Prod/ }));
    expect(onAnswer).toHaveBeenCalledWith({ type: 'pick', row: 1 });
  });

  it('free text instead of an option', () => {
    const onAnswer = card('claude-question-single');
    fireEvent.change(screen.getByLabelText('Other answer'), { target: { value: 'eu-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onAnswer).toHaveBeenCalledWith({ type: 'text', row: 2, text: 'eu-1' });
  });

  it('multi select: checkboxes and a submit button', () => {
    const onAnswer = card('claude-question-tabs-multi');
    const box = screen.getByRole('checkbox', { name: /Käse/ });
    expect(box.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(box);
    expect(onAnswer).toHaveBeenCalledWith({ type: 'pick', row: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ type: 'pick', row: 3 });
    // answered tabs show as done
    expect(screen.getByText('Farbe').closest('[data-done]')?.getAttribute('data-done')).toBe(
      'true'
    );
  });

  it('omp radio: the picked option shows as pressed', () => {
    const d = dialog('omp-ask-radio');
    d.options[1].selected = true;
    render(<QuestionCard dialog={d} onAnswer={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Prod' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Staging' }).getAttribute('aria-pressed')).toBe(null);
  });

  it('a permission: tool and command, allow, deny with a reason', () => {
    const onAnswer = card('claude-permission-bash');
    expect(screen.getByText('Bash command')).toBeTruthy();
    expect(screen.getByText(/echo 42 > b.txt/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onAnswer).toHaveBeenCalledWith({ type: 'pick', row: 0 });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'use printf' } });
    fireEvent.click(screen.getByRole('button', { name: 'No, with reason' }));
    expect(onAnswer).toHaveBeenLastCalledWith({ type: 'text', row: 3, text: 'use printf' });
  });

  it('once sent: marked answered, nothing clickable until the dialog moves on', () => {
    const onAnswer = card('claude-question-single', { sent: true });
    expect(screen.getByText(/Answer sent/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Prod/ }));
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
