import { describe, it, expect, afterEach } from 'vitest';
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChatComposer } from '../components/AgentsView/Chat/ChatComposer';

// The agent's prompt suggestion (Claude Code's ghost text) in the UI view's input

function Composer({
  suggestion,
  suggestionCut,
  takeSuggestion,
}: {
  suggestion: string | null;
  suggestionCut?: boolean;
  takeSuggestion?: () => Promise<string | null>;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  return (
    <ChatComposer
      chatId={null}
      value={value}
      onChange={setValue}
      onSubmit={() => setValue('')}
      onStop={() => {}}
      busy={false}
      disabled={false}
      submitKey="enter"
      history={[]}
      commands={[]}
      agents={[]}
      suggestion={suggestion}
      suggestionCut={suggestionCut}
      takeSuggestion={takeSuggestion}
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

  it('typing hides it, an emptied input shows it again (as in Claude Code)', () => {
    render(<Composer suggestion="weiter" />);
    fireEvent.change(input(), { target: { value: 'n' } });
    expect(input().placeholder).not.toContain('weiter');
    fireEvent.change(input(), { target: { value: '' } });
    expect(input().placeholder).toContain('weiter');
  });

  it('taken, then deleted: the suggestion comes back', () => {
    render(<Composer suggestion="weiter" />);
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('weiter');
    fireEvent.change(input(), { target: { value: '' } });
    expect(input().placeholder).toContain('weiter');
  });

  it('taken and sent: it does not flash back while the TUI still shows it', () => {
    render(<Composer suggestion="weiter" />);
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input().value).toBe('');
    expect(input().placeholder).not.toContain('weiter');
  });

  it('one cut at the pane width: marked …, Tab fills in the full text the TUI gives', async () => {
    const full =
      'Bau die Variante mit der laufenden Szenen-Figur in deinen Farben, mit Sprechblase, Foto-Porträt und kleiner Hover-Animation.';
    render(
      <Composer
        suggestion="Bau die Variante mit der laufenden Szenen-Figur"
        suggestionCut
        takeSuggestion={async () => full}
      />
    );
    expect(input().placeholder).toBe('Bau die Variante mit der laufenden Szenen-Figur…  ⇥ Tab');
    fireEvent.keyDown(input(), { key: 'Tab' });
    expect(input().value).toBe('Bau die Variante mit der laufenden Szenen-Figur');
    await waitFor(() => expect(input().value).toBe(full));
  });

  it('a cut one edited before the full text arrives keeps the edit', async () => {
    let resolve: (text: string) => void = () => {};
    render(
      <Composer
        suggestion="Bau die Variante"
        suggestionCut
        takeSuggestion={() => new Promise((r) => (resolve = r))}
      />
    );
    fireEvent.keyDown(input(), { key: 'Tab' });
    fireEvent.change(input(), { target: { value: 'Bau die Variante B' } });
    resolve('Bau die Variante mit allem');
    await new Promise((r) => setTimeout(r, 0));
    expect(input().value).toBe('Bau die Variante B');
  });

  it('a new suggestion shows again after a dropped one', () => {
    const { rerender } = render(<Composer suggestion="weiter" />);
    fireEvent.change(input(), { target: { value: 'x' } });
    fireEvent.change(input(), { target: { value: '' } });
    rerender(<Composer suggestion="teste es" />);
    expect(input().placeholder).toContain('teste es');
  });
});
