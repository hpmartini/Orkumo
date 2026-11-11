import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const { readBridgeEntry, fetchAppSessionInfo, resetAppSessionCache } =
  await import('../server/services/appSessions.js');
const { firstPromptTitle, deriveDisplayState } = await import('../server/services/agentService.js');

const BRIDGE = 'session_01D4z4TC53UyrwHVYaCd5x3m';
const UUID = '7e19734e-a75b-519d-8b5a-47668dfe5574';

describe('readBridgeEntry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-sessions-'));
  const write = (pid, entry) =>
    fs.writeFileSync(path.join(dir, `${pid}.json`), JSON.stringify(entry));

  it('recognises an interactive session spawned for the Claude app', async () => {
    write(221, {
      kind: 'interactive',
      bridgeSessionId: BRIDGE,
      sessionId: UUID,
      cwd: '/u/.claude',
    });
    expect(await readBridgeEntry(dir, 221)).toEqual({
      bridgeSessionId: BRIDGE,
      sessionId: UUID,
      cwd: '/u/.claude',
    });
  });

  it('ignores background jobs with Remote Control, plain terminals and odd ids', async () => {
    write(1, { kind: 'bg', bridgeSessionId: BRIDGE });
    write(2, { kind: 'interactive' });
    write(3, { kind: 'interactive', bridgeSessionId: '../../etc/passwd' });
    write(4, { kind: 'interactive', bridgeSessionId: BRIDGE, sessionId: '../x' });
    expect(await readBridgeEntry(dir, 1)).toBeNull();
    expect(await readBridgeEntry(dir, 2)).toBeNull();
    expect(await readBridgeEntry(dir, 3)).toBeNull();
    expect((await readBridgeEntry(dir, 4)).sessionId).toBeNull();
    expect(await readBridgeEntry(dir, 999)).toBeNull();
    expect(await readBridgeEntry(dir, -1)).toBeNull();
  });
});

describe('fetchAppSessionInfo', () => {
  const oauth = { accessToken: 'tok', expiresAt: Date.now() + 3_600_000 };
  const ok = (body) => ({ ok: true, json: async () => body });

  beforeEach(() => resetAppSessionCache());

  it("reads claude.ai's title, origin and turn status with the login", async () => {
    const fetchFn = vi.fn(async () =>
      ok({
        title: 'DevHub und TexBase Issues abarbeiten',
        origin: 'ios',
        post_turn_summary: { status_category: 'need_input', status_detail: 'Soll Joplin weg?' },
      })
    );
    const info = await fetchAppSessionInfo(BRIDGE, { readOauth: async () => oauth, fetchFn });
    expect(info).toEqual({
      title: 'DevHub und TexBase Issues abarbeiten',
      origin: 'ios',
      statusCategory: 'need_input',
      statusDetail: 'Soll Joplin weg?',
    });
    expect(fetchFn.mock.calls[0][0]).toBe(`https://api.anthropic.com/v1/sessions/${BRIDGE}`);
    expect(fetchFn.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
  });

  it('keeps the last good answer when claude.ai fails later', async () => {
    const readOauth = async () => oauth;
    const now = Date.now();
    await fetchAppSessionInfo(BRIDGE, {
      readOauth,
      now,
      fetchFn: async () => ok({ title: 'Erster Titel', origin: 'ios' }),
    });
    const later = await fetchAppSessionInfo(BRIDGE, {
      readOauth,
      now: now + 120_000,
      fetchFn: async () => ({ ok: false }),
    });
    expect(later?.title).toBe('Erster Titel');
  });

  it('asks nothing without a valid login', async () => {
    const fetchFn = vi.fn();
    const expired = { accessToken: 'tok', expiresAt: Date.now() - 1 };
    expect(
      await fetchAppSessionInfo(BRIDGE, { readOauth: async () => expired, fetchFn })
    ).toBeNull();
    resetAppSessionCache();
    expect(await fetchAppSessionInfo(BRIDGE, { readOauth: async () => null, fetchFn })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('firstPromptTitle', () => {
  const line = (record) => JSON.stringify(record);

  it('skips meta, compaction summaries, tool results and notifications', () => {
    const head = [
      line({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok=89' }] } }),
      line({
        type: 'user',
        isCompactSummary: true,
        message: { content: 'This session is being continued' },
      }),
      line({
        type: 'user',
        isMeta: true,
        message: { content: 'Continue from where you left off.' },
      }),
      line({ type: 'user', message: { content: '<task-notification>\n<task-id>x</task-id>' } }),
      'not json',
      line({
        type: 'user',
        message: { content: [{ type: 'text', text: 'Passt   soweit.\nWeiter' }] },
      }),
    ].join('\n');
    expect(firstPromptTitle(head)).toBe('Passt soweit. Weiter');
  });

  it('keeps a slash command with its arguments and shortens long prompts', () => {
    const command =
      '<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>/mw:delegate Alle issues</command-args>';
    expect(firstPromptTitle(line({ type: 'user', message: { content: command } }))).toBe(
      '/goal /mw:delegate Alle issues'
    );
    const long = firstPromptTitle(line({ type: 'user', message: { content: 'x'.repeat(300) } }));
    expect(long).toHaveLength(120);
    expect(long.endsWith('…')).toBe(true);
    expect(firstPromptTitle('')).toBeNull();
  });
});

describe('deriveDisplayState for Claude app sessions', () => {
  it('follows the local process, then whether claude.ai waits for an answer', () => {
    expect(deriveDisplayState({ kind: 'app', status: 'busy' })).toBe('working');
    expect(
      deriveDisplayState({ kind: 'app', status: 'idle', app: { statusCategory: 'need_input' } })
    ).toBe('needs-input');
    expect(deriveDisplayState({ kind: 'app', status: 'idle', waitingFor: 'permission' })).toBe(
      'needs-input'
    );
    expect(
      deriveDisplayState({ kind: 'app', status: 'idle', app: { statusCategory: 'completed' } })
    ).toBe('idle');
  });
});
