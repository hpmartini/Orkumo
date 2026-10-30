import { describe, it, expect } from 'vitest';
import { isAllowedExec } from '../pty-host/execPolicy.js';

const JOB = 'gui/501/de.martini-labs.mw-board';

describe('pty-host isAllowedExec', () => {
  it('claude stays allowed with any arguments', () => {
    expect(isAllowedExec('claude', ['agents', '--json'], 501)).toBe(true);
  });

  it('launchctl only with exactly the mw-board kickstart of the host user', () => {
    expect(isAllowedExec('launchctl', ['kickstart', JOB], 501)).toBe(true);
    for (const args of [
      ['kickstart', '-k', JOB],
      ['kickstart', JOB, 'extra'],
      ['kickstart', 'gui/0/de.martini-labs.mw-board'],
      ['kickstart', 'gui/501/com.apple.Finder'],
      ['kickstart', 'gui/501/de.martini-labs.mw-board;rm'],
      ['bootout', JOB],
      ['kickstart'],
      [],
      'kickstart ' + JOB,
    ]) {
      expect(isAllowedExec('launchctl', args, 501)).toBe(false);
    }
  });

  it('other commands stay refused', () => {
    for (const cmd of ['/bin/launchctl', 'sh', 'mw', undefined, 42]) {
      expect(isAllowedExec(cmd, ['kickstart', JOB], 501)).toBe(false);
    }
  });
});
