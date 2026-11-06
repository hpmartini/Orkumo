/** Test provider: starts through a host command that prints `{action, reason}` (exit 3 = no slot) */
export default {
  id: 'cli-provider',
  name: 'CLI Provider',
  workflow: {
    apiVersion: 1,
    name: 'CLI Provider',
    stages: [{ id: 'open', label: 'Open' }],
    annotate: (item) =>
      item.labels.some((l) => l.name === 'wf:open')
        ? { state: { stage: 'open', waitingOn: 'owner', reason: 'offen' }, sessionIds: [] }
        : null,
    commands: { go: ['wf-tool', 'start', '{issue}', '--json'] },
    async start(_url, host) {
      const r = await host.exec('go');
      const out = JSON.parse(r.stdout.trim().split('\n').pop());
      return { action: out.action, reason: out.reason, ...(r.code === 3 && { full: true }) };
    },
  },
  register() {},
};
