# Workflow provider contract (v1)

Orkumo shows board issues on a workflow track (stage, who it waits on, a GO button, the agent working
on it) and lets you steer the workflow from the issue dialog. Orkumo itself knows no workflow tool:
all of that comes from **one workflow provider**, an [optional module](MODULES.md) whose default
export carries a `workflow` field. Without a provider the board is a plain board: no workflow state,
no GO buttons, no control flow section, no "Workflow" agent filter hits.

Why this shape: [ADR-001](adr/ADR-001-workflow-provider.md).

A minimal provider that needs no external tool: [`examples/workflow-provider-labels`](../examples/workflow-provider-labels/index.js).

## Declaring a provider

```js
export default {
  id: 'my-workflow', // module id (MODULES.md)
  name: 'My Workflow',
  workflow: {
    apiVersion: 1, // this document; the host refuses other versions
    name: 'My Workflow', // shown in the UI
    stages: [{ id: 'todo', label: 'Todo', hint: 'optional tooltip' }], // ordered, ids unique
    annotate(item, status) {}, // required, see below
    controls: {}, // optional, issue dialog
    sessionName: '^WF (\\S+)#(\\d+)(?: +(.*))?$', // optional
    commands: {}, // optional, host commands start/go may run
    async start(url, host) {}, // optional, "start now"
    async go(kind, ctx) {}, // optional, side effects of a GO
  },
  register(ctx) {},
};
```

At most one loaded module may declare `workflow`; a second one is skipped with an error in the log.
The host validates the declaration when the module loads (`server/services/workflowProvider.js`,
`validateProvider`); an invalid one is skipped like any failing module, so a broken provider never
takes the board down.

## `annotate(item, status)` — required, pure, synchronous

Called by the host for every issue it loads (board refresh, single-item refresh). Must not do I/O:
the board has hundreds of items and is refreshed often.

- `item`: the board item (`types.ts` `BoardItem`: `labels`, `state`, `closedAt`, `pullRequests`,
  `subIssues`, `repo`, `number`, `url`, …) plus `comments: { body, createdAt }[]`, the last 20
  comments **written by trusted authors only** (the board owner). The host filters before the
  provider sees them, so a stranger's comment can never move a stage, whatever a provider parses.
- `status`: name of the item's board column (`'Todo'`, `'Done'`, …) or `null`.

Returns `null` when the issue is not part of the workflow, else:

```ts
{
  state: {
    stage: string,                 // one of stages[].id
    waitingOn: 'owner' | 'agent' | 'poll' | null,
    reason: string,                // one line, shown on the card
    since: string | null,          // ISO time the stage began, if known
    go: { kind: string, text: string, panel?: boolean } | null, // GO the owner can give now
    error: { label: string, note: string, at: string | null } | null,
    // any further fields are provider-specific and passed through untouched (for the provider's own UI)
  },
  sessionIds: string[],            // agent session UUIDs working on this issue (links agents to issues)
}
```

The host stores the result as `item.workflow` (`null` without provider). Raw comments do not reach
the client.

## `controls` — optional, issue dialog

All controls are labels on the issue; a label missing in the repo disables its button.

```ts
{
  toggles?: { label: string, text: string, hint: string }[],  // on/off buttons
  start?: { label: string, text: string, hint: string },      // set label (stays set), then start now
  feedback?: { label: string, text: string, hint: string }[], // post comment, set label, then start now
  modes?: { options: { text: string, label: string | null }[], drop?: string[] }, // exclusive labels
  waiting?: { label: string, text: string },                  // badge while the label is set
}
```

Without `controls` the dialog shows no control flow section.

## `sessionName` — optional

Regex source matched against agent session names: group 1 repo name, group 2 issue number, group 3
(optional) the title shown instead of the full name. Matching sessions count as workflow agents.

## `commands`, `start`, `go` — optional, host execution

A provider never builds a command line from request data. It declares argv templates:

```js
commands: {
  go: ['my-tool', 'start', '{issue}', '--json'],
  kick: ['launchctl', 'kickstart', 'gui/{uid}/my.job'],
}
```

`{issue}` is replaced by the issue URL, which the host has checked against
`^https://github.com/<owner>/<repo>/issues/<n>$`; `{uid}` by the host user id. No other
placeholders exist. The provider runs them only through `host.exec(name)`; in Docker the host sends
them to pty-host, which runs nothing that is not in its own allowlist (below).

`start(url, host)` starts or wakes the issue now. `host`:
`{ exec(name) -> Promise<{ code, stdout, stderr }> }` (the URL is bound by the host). Returns

```ts
{ action: 'start' | 'resume' | 'queued' | 'none', reason: string, full?: boolean }
```

- `start` / `resume`: an agent runs now.
- `queued`: accepted, starts later (e.g. with the next poll); `reason` says when.
- `none`: nothing started; `reason` says why. `full: true` means "no free slot" — the UI then says it
  starts as soon as one is free.
- A thrown error is reported as "not started: <message>".

`go(kind, ctx)` applies a GO the fresh state offers. The host first checks that `kind` equals
`state.go.kind` of the item as GitHub has it now (else HTTP 409, nothing runs). `ctx`:
`{ item, setLabels(names) -> Promise<item>, start() -> Promise<StartResult> }`. Returns
`{ note?: string, start?: StartResult }`; `note` is appended to the toast. Without `go` the host
just calls `start`.

## pty-host allowlist (Docker)

pty-host runs `claude` with any arguments and otherwise only argv lists from an owner-written JSON
file: `PTY_HOST_EXEC_RULES`, default `~/.config/orkumo/exec-rules.json`. Missing file: only `claude`.

```json
[{ "command": "my-tool", "args": ["start", "{issue}", "--json"] }]
```

Same placeholders and checks as above (`{issue}` only as a whole argument, `{uid}` anywhere); every
other argument must match exactly. The provider's
documentation ships the rules its `commands` need.

## HTTP API

- `GET /api/workflow` -> `{ provider: null | { name, apiVersion, stages, controls, sessionName } }`
- `POST /api/workflow/start` `{ url }` -> `StartResult` (404 without provider or `start`)
- `POST /api/workflow/go` `{ itemId, go: { kind } }` -> `{ ok, item?, note?, start? }` or 409

Modules get the same through `ctx.services.workflow` (MODULES.md).

## Versioning

`apiVersion` is an integer. Additive changes (new optional fields) keep the version; anything a v1
provider or a v1 host could misread raises it. The host refuses unknown versions with a log line
naming the supported one.
