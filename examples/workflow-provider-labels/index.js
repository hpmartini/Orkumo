/**
 * Minimal workflow provider (docs/WORKFLOW_PROVIDER.md): the stage is a label `wf:todo`,
 * `wf:doing` or `wf:done`. No external tool, no host commands.
 * Try it: DEVHUB_PREMIUM_DIR=<repo>/examples node server/index.js
 */
const STAGES = [
  { id: 'todo', label: 'Todo' },
  { id: 'doing', label: 'Doing' },
  { id: 'done', label: 'Done' },
];

function annotate(item) {
  const names = new Set((item.labels ?? []).map((l) => l.name));
  const stage = [...STAGES].reverse().find((s) => names.has(`wf:${s.id}`))?.id;
  if (!stage) return null;
  if (stage === 'todo') {
    return {
      state: {
        stage,
        waitingOn: 'owner',
        reason: 'Wartet auf Start',
        go: { kind: 'doing', text: 'Starten' },
      },
      sessionIds: [],
    };
  }
  const reason = stage === 'done' ? 'Erledigt' : 'In Arbeit';
  return { state: { stage, waitingOn: stage === 'done' ? null : 'agent', reason }, sessionIds: [] };
}

async function go(kind, ctx) {
  const names = (ctx.item.labels ?? []).map((l) => l.name).filter((n) => n !== 'wf:todo');
  const item = await ctx.setLabels([...names, `wf:${kind}`]);
  return { item, note: `wf:${kind} gesetzt` };
}

export default {
  id: 'workflow-labels',
  name: 'Label Workflow',
  workflow: {
    apiVersion: 1,
    name: 'Label Workflow',
    stages: STAGES,
    annotate,
    controls: {
      toggles: [{ label: 'wf:todo', text: 'Todo', hint: 'In den Workflow aufnehmen' }],
    },
    go,
  },
  register() {},
};
