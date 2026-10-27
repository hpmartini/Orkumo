import { describe, it, expect } from 'vitest';
import { parseCloudTarget, buildCloudArgs } from '../utils/cloudSession';

const UUID = '3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b';
const SID = 'session_01G2447dt7hBAKuuCVUaoFCF';

describe('parseCloudTarget', () => {
  it('accepts a UUID and a session_ id', () => {
    expect(parseCloudTarget(UUID)).toEqual({ ok: true, id: UUID });
    expect(parseCloudTarget(` ${SID} `)).toEqual({ ok: true, id: SID });
  });

  it('accepts a claude.ai/code URL and extracts the id', () => {
    expect(parseCloudTarget(`https://claude.ai/code/${SID}`)).toEqual({ ok: true, id: SID });
    expect(parseCloudTarget(`https://claude.ai/code/${SID}?x=1`)).toEqual({ ok: true, id: SID });
  });

  it('rejects foreign hosts, http and look-alike hosts', () => {
    expect(parseCloudTarget(`https://evil.com/code/${SID}`).ok).toBe(false);
    expect(parseCloudTarget(`http://claude.ai/code/${SID}`).ok).toBe(false);
    expect(parseCloudTarget(`https://claude.ai.evil.com/code/${SID}`).ok).toBe(false);
    expect(parseCloudTarget(`https://claude.ai@evil.com/code/${SID}`).ok).toBe(false);
  });

  it('rejects wrong paths', () => {
    expect(parseCloudTarget('https://claude.ai/chat/abc').ok).toBe(false);
    expect(parseCloudTarget(`https://claude.ai/code/${SID}/extra`).ok).toBe(false);
  });

  it('rejects shell metacharacters and free text', () => {
    for (const bad of [
      `${SID}; rm -rf /`,
      '$(whoami)',
      '`id`',
      `${UUID} && ls`,
      'fix the login bug',
      '',
    ]) {
      expect(parseCloudTarget(bad).ok).toBe(false);
    }
  });
});

describe('buildCloudArgs', () => {
  it('uses --teleport without target', () => {
    expect(buildCloudArgs()).toEqual(['--teleport']);
  });
  it('uses --cloud with the extracted id', () => {
    expect(buildCloudArgs(`https://claude.ai/code/${SID}`)).toEqual(['--cloud', SID]);
  });
  it('throws on invalid target', () => {
    expect(() => buildCloudArgs('nope; ls')).toThrow();
  });
});
