# ADR-001: Workflow tools plug in as a provider module

Status: accepted · 2026-11-06 · origin: hpmartini/example-workflow-plugin#219

## Context

Orkumo is open source. Its board showed workflow stages, GO buttons, the issue dialog's control flow
and the link between agents and issues — all hardcoded for one tool, Martini Workflows (mw): label
names (`mw:go`, `mw:build`, …), `<!-- mw-board:… -->` marker comments, the mw stage model
(`utils/workflowStage.js`), `mw board go` and its exit code 3, the launchd job
`de.martini-labs.mw-board`, the `MACC` session name prefix and a pty-host allowlist naming `mw`.
A user without mw got half-working screens; another workflow tool could not plug in; every mw
change to a label or marker needed an Orkumo PR.

What the integration has to carry:

1. Per issue and refresh: stage, waiting-on, reason, GO offer, error, linked agent sessions —
   derived from data the board already loads (labels, column, trusted comments). Hundreds of items,
   refreshed often.
2. A few owner actions: start now, apply a GO, label controls in the issue dialog.
3. A trust boundary: the browser sends an issue URL; something then runs on the host (in Docker via
   pty-host).

## Options

|     | Option                                                                                                                                                                                                       | For                                                                                                                                                                                                                                           | Against                                                                                                                                                                                                       |
| :-- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | **CLI provider protocol** — Orkumo calls a configured executable with JSON over stdio (`<cmd> describe`, `<cmd> annotate < items.json`, `<cmd> start <url>`), like git credential helpers or kubectl plugins | language-neutral; process isolation; mw is a CLI already                                                                                                                                                                                      | one process per board refresh (Python start ≈ 100–300 ms) or a long-lived daemon; host must still run the command (pty-host in Docker), so the allowlist problem stays; versioning and errors over exit codes |
| B   | **Provider module** — the workflow tool ships an Orkumo module (existing `MODULES.md` loader) whose export declares `workflow: { apiVersion, stages, annotate, controls, commands, start, go }`              | reuses the loader, its validation and its mount points; `annotate` is an in-process pure function (no I/O per refresh); the tool owns its adapter, so label/marker changes ship with the tool; host commands declared as fixed argv templates | provider code runs in the server process (same trust as any module: owner-installed); JS only                                                                                                                 |
| C   | **Generic label/marker schema** — Orkumo defines its own labels/markers (`orkumo:stage=…`) and tools write them                                                                                              | no code in Orkumo from the tool; GitHub is the bus                                                                                                                                                                                            | every tool must adopt Orkumo's vocabulary (mw writes its own markers today and others won't change theirs); actions (start now) still need a command path; stage logic duplicated in each tool                |
| D   | **MCP / JSON-RPC server** the tool runs                                                                                                                                                                      | rich, discoverable, language-neutral                                                                                                                                                                                                          | a server to install, keep alive and secure for a handful of calls; same per-refresh latency question as A; heavy for a pure derivation                                                                        |
| E   | **Webhooks / GitHub App** — the tool pushes state to Orkumo                                                                                                                                                  | real-time                                                                                                                                                                                                                                     | Orkumo is a local app, often without a reachable URL; needs persistence Orkumo does not have; actions still need the reverse path                                                                             |

Reference practice: VS Code declares extension capabilities in a manifest (contribution points) and
loads code in-process behind a versioned API ([contribution points](https://code.visualstudio.com/api/references/contribution-points));
LSP negotiates capabilities in a versioned handshake ([LSP initialize](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#initialize));
Terraform keeps providers out of process behind a versioned protocol because they do heavy I/O
([plugin protocol](https://developer.hashicorp.com/terraform/plugin/terraform-plugin-protocol));
git credential helpers show the stdio-CLI style for rare calls ([gitcredentials](https://git-scm.com/docs/gitcredentials)).
The common rule: the host owns a small, versioned contract; frequent pure calls run in-process,
rare effectful calls go through a narrow, declared channel.

## Decision

**B, with A's declaration discipline for host commands.** The host (Orkumo) owns the contract
([WORKFLOW_PROVIDER.md](../WORKFLOW_PROVIDER.md)), validates providers at load time and keeps every
trust decision:

- `annotate` sees only comments of trusted authors (filtered by the host), so no provider can be
  steered by strangers.
- The browser still sends only an issue URL (checked by regex); providers run host commands only
  as declared argv templates with `{issue}`/`{uid}`, and pty-host additionally checks an
  owner-written allowlist file. Nothing from a request becomes a command or an argument.
- No provider: plain board.

mw ships its provider in its own repo (`plugins/mw/orkumo/`), so mw changes no longer need Orkumo
PRs. A label-only example provider (`examples/workflow-provider-labels`) proves a second tool fits
without host changes.

## Consequences

- Orkumo core has no mw names left; `git grep -E 'mw:|mw-board|mw board|de\.martini-labs'` outside
  docs finds nothing.
- Module loading accepts several directories (`DEVHUB_PREMIUM_DIR` is a path list), so the mw
  provider and other modules load side by side.
- Running mw with Orkumo needs one setup step: add the provider's directory to the module path and,
  in Docker, its exec rules to pty-host's allowlist.
- A non-JS tool writes a small JS module that calls its CLI in `start` — the rare path — and does
  its stage derivation in JS (pure, no I/O). If that turns out to be a real barrier, option A can be
  added later as a built-in "CLI provider" module without changing the contract.
