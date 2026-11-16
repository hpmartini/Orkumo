// Chat stream fed by the page: window.harness.emit(events) as if the transcript tail sent them
type Handlers = { onOpen: () => void; onEvent: (e: unknown) => void; onGone: () => void };
let current: Handlers | null = null;
const backlog: unknown[] = [];
(window as unknown as { harness: object }).harness = {
  emit(events: unknown[]) {
    backlog.push(...events);
    events.forEach((e) => current?.onEvent(e));
  },
};
export const openTranscriptView = async () => ({ id: 'view-1' });
export function subscribeToChat(_id: string, handlers: Handlers) {
  current = handlers;
  handlers.onOpen();
  backlog.forEach((e) => handlers.onEvent(e));
  return () => {
    current = null;
  };
}
export const uploadAttachment = async () => '';
export const agentImageUrl = () => null;
export const fetchChatStatus = () => new Promise(() => {});
export const fetchChatFiles = async () => [];
export const fetchChatShell = async () => null;
export const fetchChatArtifacts = async () => ({ artifacts: [] });
export const fetchChatArtifactContent = async () => '';
export type ChatStatus = Record<string, unknown>;
export type ChatArtifact = Record<string, unknown>;
