/**
 * Workflow view model: board items in an mw workflow, each with its derived stage.
 */
import type { BoardItem, BoardStatusOption, WorkflowRunInfo } from '../types';
import { itemKey, withinDoneWindow } from './board';
import { deriveNode } from './workflowGraph.js';
import {
  WORKFLOW_STAGES,
  deriveWorkflowState,
  isWorkflowItem,
  type WorkflowState,
  type WorkflowStageId,
} from './workflowStage.js';

export interface WorkflowCard {
  key: string;
  item: BoardItem;
  run: WorkflowRunInfo | null;
  state: WorkflowState;
  /** graph station and, inside a loop, its round */
  node: { id: string; round: string | null };
}

export const stageIndex = (id: WorkflowStageId) => WORKFLOW_STAGES.findIndex((s) => s.id === id);

/** Workflow issues with their stage; finished ones only within the board's done window */
export function buildWorkflowCards(
  items: BoardItem[],
  options: BoardStatusOption[],
  runs: Record<string, WorkflowRunInfo>,
  now: number
): WorkflowCard[] {
  const statusName = new Map(options.map((o) => [o.id, o.name]));
  return items
    .filter((i) => i.type === 'Issue' && isWorkflowItem(i))
    .map((item) => {
      const key = itemKey(item);
      const run = runs[key] ?? null;
      const status = item.statusOptionId ? (statusName.get(item.statusOptionId) ?? null) : null;
      const state = deriveWorkflowState(item, status, run);
      return { key, item, run, state, node: deriveNode(item, state, run, status) };
    })
    .filter((c) => c.state.stage !== 'done' || withinDoneWindow(c.item, now))
    .sort(
      (a, b) =>
        Number(b.state.waitingOn === 'hape') - Number(a.state.waitingOn === 'hape') ||
        b.item.updatedAt.localeCompare(a.item.updatedAt)
    );
}

/** Cards of one repo ("owner/name") and/or one agent (job id = first 8 chars of the session) */
export function scopeWorkflowCards(
  cards: WorkflowCard[],
  { repo, agent, repos }: { repo?: string | null; agent?: string | null; repos?: readonly string[] }
): WorkflowCard[] {
  const picked = new Set(repos?.map((r) => r.toLowerCase()));
  return cards.filter(
    (c) =>
      (!repo || c.item.repo?.toLowerCase() === repo.toLowerCase()) &&
      (!agent || c.state.sessionId?.slice(0, 8) === agent) &&
      (!picked.size || picked.has(c.item.repo?.toLowerCase() ?? ''))
  );
}

export interface StageMove {
  key: string;
  from: string;
  to: string;
}

/** Cards whose graph station changed since `prev` (key -> node id); new cards are no move */
export function stageMoves(prev: Map<string, string>, cards: WorkflowCard[]): StageMove[] {
  return cards.flatMap((c) => {
    const from = prev.get(c.key);
    return from !== undefined && from !== c.node.id ? [{ key: c.key, from, to: c.node.id }] : [];
  });
}
