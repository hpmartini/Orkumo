import { describe, it, expect, afterEach } from 'vitest';
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChatComposer } from '../components/AgentsView/Chat/ChatComposer';

// The agent's prompt suggestion (Claude Code's ghost text) in the UI view's input

function Composer({
  suggestion,
  submitKey = 'enter',
}: {
  suggestion: string | null;
  submitKey?: 'enter' | 'mod+enter';
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  return (
    <ChatComposer
      chatId={null}
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      onStop={() => {}}
      busy={false}
      disabled={false}
      submitKey={submitKey}
      history={[]}
      commands={[]}
      agents={[]}
      suggestion={suggestion}
      inputRef={inputRef}
    />
  );
}

const input = () => screen.getByLabelText('Message') as HTMLTextAreaElement;

describe('prompt suggestion in the chat input', () => {
  afterEach(cleanup);

  it('shows in the empty input and Tab takes it', () => {
    render(<Composer suggestion="Ja, leg die Datei an." />);
    expect(input().placeholder).toContain('Ja, leg die Datei an.');
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('Ja, leg die Datei an.');
  });

  it('→ takes it too', () => {
    render(<Composer suggestion="weiter" />);
    fireEvent.keyDown(input(), { key: 'ArrowRight' });
    expect(input().value).toBe('weiter');
  });

  it('typing drops it: cleared input shows no suggestion, Tab stays a key', () => {
    render(<Composer suggestion="weiter" />);
    fireEvent.change(input(), { target: { value: 'n' } });
    fireEvent.change(input(), { target: { value: '' } });
    expect(input().placeholder).not.toContain('weiter');
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('');
  });

  it('a taken suggestion does not come back once the input is sent and empty', () => {
    render(<Composer suggestion="weiter" />);
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.change(input(), { target: { value: '' } });
    expect(input().placeholder).not.toContain('weiter');
  });

  it('a new suggestion shows again after a dropped one', () => {
    const { rerender } = render(<Composer suggestion="weiter" />);
    fireEvent.change(input(), { target: { value: 'x' } });
    fireEvent.change(input(), { target: { value: '' } });
    rerender(<Composer suggestion="teste es" />);
    expect(input().placeholder).toContain('teste es');
  });

  // A click on an open agent's card focuses this input; the next Enter was meant for the card
  it('Enter in the empty input writes no newline and keeps the suggestion', () => {
    render(<Composer suggestion="weiter" submitKey="mod+enter" />);
    const kept = fireEvent.keyDown(input(), { key: 'Enter' });
    expect(kept).toBe(false); // default (the newline) prevented
    expect(input().value).toBe('');
    expect(input().placeholder).toContain('weiter');
  });

  it('Enter after text still makes a newline', () => {
    render(<Composer suggestion={null} submitKey="mod+enter" />);
    fireEvent.change(input(), { target: { value: 'a' } });
    expect(fireEvent.keyDown(input(), { key: 'Enter' })).toBe(true);
  });
});
