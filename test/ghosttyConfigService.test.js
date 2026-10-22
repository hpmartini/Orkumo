import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getGhosttyConfig,
  buildResult,
  parseEntries,
} from '../server/services/ghosttyConfigService.js';

describe('ghosttyConfigService', () => {
  it('maps colors, palette, font and cursor; first font-family wins', () => {
    const r = buildResult(
      parseEntries(
        [
          '# comment',
          'background = 304370',
          'foreground = #FFFFFF',
          'cursor-text = red',
          'palette = 0=#3a4d6b',
          'palette = 15=#ffffff',
          'font-family = "Fira Code"',
          'font-family = Menlo',
          'font-size = 14',
          'cursor-style = block_hollow',
          'cursor-style-blink = false',
        ].join('\n')
      )
    );
    expect(r.theme).toEqual({
      background: '#304370',
      foreground: '#ffffff',
      black: '#3a4d6b',
      brightWhite: '#ffffff',
    });
    expect(r).toMatchObject({
      fontFamily: 'Fira Code',
      fontSize: 14,
      cursorStyle: 'block',
      cursorBlink: false,
    });
  });

  it('resolves includes (symlink, missing optional) and lets user keys win over the theme', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostty-'));
    fs.writeFileSync(path.join(dir, 'real.ghostty'), 'font-size = 20\n');
    fs.symlinkSync(path.join(dir, 'real.ghostty'), path.join(dir, 'host.ghostty'));
    fs.writeFileSync(path.join(dir, 'mytheme'), 'background = #222222\nforeground = #eeeeee\n');
    const main = path.join(dir, 'config');
    fs.writeFileSync(
      main,
      `theme = ${path.join(dir, 'mytheme')}\nbackground = #111111\nconfig-file = ?host.ghostty\nconfig-file = ?nope.ghostty\n`
    );
    const r = getGhosttyConfig([main]);
    expect(r.found).toBe(true);
    expect(r.theme.background).toBe('#111111');
    expect(r.theme.foreground).toBe('#eeeeee');
    expect(r.fontSize).toBe(20);
  });

  it('reports found=false without config', () => {
    expect(getGhosttyConfig(['/nonexistent/termcfg-sample']).found).toBe(false);
  });
});
