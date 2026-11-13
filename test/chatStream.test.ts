import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { subscribeToChat } from '../services/agentsApi';

/** Minimal EventSource: the test drives `emit` / `fail` */
class FakeEventSource {
  static CLOSED = 2;
  static all: FakeEventSource[] = [];
  readyState = 0;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.all.push(this);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: unknown) {
    const e = { data: JSON.stringify(data) } as MessageEvent;
    if (type === 'message') this.onmessage?.(e);
    else this.listeners.get(type)?.forEach((fn) => fn(e));
  }
}

const CHAT_A = '11111111-1111-4111-8111-111111111111';
const CHAT_B = '22222222-2222-4222-8222-222222222222';
const handlers = () => ({ onOpen: vi.fn(), onEvent: vi.fn(), onGone: vi.fn() });
let fetchMock: ReturnType<typeof vi.fn>;
const watchCalls = (method: string) =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === method)
    .map(([url, init]) => ({ url: String(url), ...JSON.parse(init.body) }));

beforeEach(() => {
  FakeEventSource.all = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('subscribeToChat', () => {
  it('carries every view of the window on one connection and re-watches after a reconnect', async () => {
    const a = handlers();
    const b = handlers();
    const offA = subscribeToChat(CHAT_A, a);
    const offB = subscribeToChat(CHAT_B, b);
    expect(FakeEventSource.all).toHaveLength(1);
    const [source] = FakeEventSource.all;
    const client = new URL(source.url, 'http://x').searchParams.get('client');

    source.emit('ready', {});
    await vi.waitFor(() => expect(watchCalls('POST')).toHaveLength(2));
    const [watchA, watchB] = watchCalls('POST');
    expect(watchA).toMatchObject({ client, url: expect.stringContaining(`/chat/${CHAT_A}/watch`) });
    expect(watchB.url).toContain(`/chat/${CHAT_B}/watch`);

    source.emit('watch', { sub: watchA.sub });
    source.emit('message', { sub: watchA.sub, event: { type: 'assistant' } });
    expect(a.onOpen).toHaveBeenCalledOnce();
    expect(a.onEvent).toHaveBeenCalledWith({ type: 'assistant' });
    expect(b.onEvent).not.toHaveBeenCalled();

    // the stream dropped and came back: both views are watched again (fresh replay)
    source.onerror?.();
    source.emit('ready', {});
    await vi.waitFor(() => expect(watchCalls('POST')).toHaveLength(4));

    offA();
    await vi.waitFor(() =>
      expect(watchCalls('DELETE')).toEqual([expect.objectContaining({ sub: watchA.sub })])
    );
    offB();
    expect(source.readyState).toBe(FakeEventSource.CLOSED);
  });

  it('reports a view the server no longer has as gone', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Chat session not found' }), { status: 404 })
    );
    const a = handlers();
    const off = subscribeToChat(CHAT_A, a);
    FakeEventSource.all[0].emit('ready', {});
    await vi.waitFor(() => expect(a.onGone).toHaveBeenCalledOnce());
    off();
  });
});
