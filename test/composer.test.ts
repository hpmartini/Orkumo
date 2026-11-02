import { describe, it, expect } from 'vitest';
import { submitIntent, promptWithImages, bodyWithImages, imageFiles } from '../utils/composer';

const key = (k: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean }> = {}) => ({
  key: k,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
});

describe('composer - submitIntent', () => {
  it('keeps plain and Shift+Enter as a newline', () => {
    expect(submitIntent(key('Enter'))).toBeNull();
    expect(submitIntent(key('Enter', { shift: true }))).toBeNull();
  });

  it('submits on Cmd+Enter and Ctrl+Enter; Shift adds attach', () => {
    expect(submitIntent(key('Enter', { meta: true }))).toEqual({ attach: false });
    expect(submitIntent(key('Enter', { ctrl: true }))).toEqual({ attach: false });
    expect(submitIntent(key('Enter', { meta: true, shift: true }))).toEqual({ attach: true });
  });

  it('ignores other keys and IME composition', () => {
    expect(submitIntent(key('a', { meta: true }))).toBeNull();
    expect(
      submitIntent({ ...key('Enter', { meta: true }), nativeEvent: { isComposing: true } })
    ).toBeNull();
  });
});

describe('composer - images', () => {
  it('appends image paths to the prompt', () => {
    expect(promptWithImages('  fix it  ', [])).toBe('fix it');
    expect(promptWithImages('look', ['/a.png', '/b.jpg'])).toBe(
      'look\n[Image: /a.png]\n[Image: /b.jpg]'
    );
    expect(promptWithImages('  ', ['/a.png'])).toBe('[Image: /a.png]');
  });

  it('embeds uploaded images in the issue body', () => {
    expect(bodyWithImages('text', [])).toBe('text');
    expect(bodyWithImages('text\n', ['https://x/1.png'])).toBe(
      'text\n\n![image-1](https://x/1.png)'
    );
    expect(bodyWithImages('', ['u1', 'u2'])).toBe('![image-1](u1)\n![image-2](u2)');
  });

  it('keeps only image files', () => {
    const png = new File(['x'], 'a.png', { type: 'image/png' });
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' });
    expect(imageFiles([png, txt])).toEqual([png]);
    expect(imageFiles(null)).toEqual([]);
  });
});
