/**
 * Workflow view model: board items in an mw workflow, each with its derived stage.
 */
import type { BoardItem, BoardStatusOption, WorkflowRunInfo } from '../types';
import { itemKey, withinDoneWindow } from './board';
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
      return { key, item, run, state: deriveWorkflowState(item, status, run) };
    })
    .filter((c) => c.state.stage !== 'done' || withinDoneWindow(c.item, now))
    .sort(
      (a, b) =>
        Number(b.state.waitingOn === 'hape') - Number(a.state.waitingOn === 'hape') ||
        b.item.updatedAt.localeCompare(a.item.updatedAt)
    );
}

export interface StageMove {
  key: string;
  from: number;
  to: number;
}

/** Cards whose stage changed since `prev` (key -> stage index); new cards are no move */
export function stageMoves(prev: Map<string, number>, cards: WorkflowCard[]): StageMove[] {
  const moves: StageMove[] = [];
  for (const c of cards) {
    const from = prev.get(c.key);
    const to = stageIndex(c.state.stage);
    if (from !== undefined && from !== to) moves.push({ key: c.key, from, to });
  }
  return moves;
}
