# Status view: full descriptions, chat context, Instruct

Follow-up to the Status view briefing (owner wishes of 2026-11-20). Each item in the Status view has
two levels: a short line in the list, and on demand the full description and the orchestrator's
chat answer it came from. From every card and task row, the owner can instruct the responsible
orchestrator directly, with images and files.

## Contract

### Report schema (`server/services/orchestratorReport.js`, JSON schema generated)

- Inbox entry and task: optional `description`, Markdown, up to 20 000 characters. `detail` (inbox)
  and `note` (task) stay the one-line summary.
- Inbox entry: `projectId` is **required** and must name a project of the same report. A missing or
  unknown id fails with: `add projectId; use a project 'general' for items without a project`.
- `context` is not a report field (strict schemas reject it): the server attaches it.

### Chat context (server)

- `submit` marks every inbox entry and task that is new or changed (title, detail/note,
  description, state, options, pr) as pending, with `pendingSince = receivedAt`.
- The report evaluation (60 s poll and every GET) checks pending reports. Once the orchestrator's
  agent is not busy and its transcript has an assistant text at or after `pendingSince`, the last
  such text (full, up to 20 000 characters) and its timestamp are stored as
  `contexts[key] = { text, at }` for every pending key, and pending is cleared. Keys:
  `inbox:<entryId>`, `task:<projectId>:<taskId>`. Unchanged items keep their context; items gone
  from the report drop it. Pending expires after 2 h without an answer.
- `GET /api/orchestrator/reports` returns `contexts` per report (`{}` when none).

### Instruct (server)

- `POST /api/orchestrator/reports/:id/instruct`, body
  `{ entry?: id, task?: { project: id, task: id }, text: string (1..8000), attachments?: [{ path, kind: 'image'|'file' }] (max 10) }`.
  Exactly one of `entry`/`task`. Attachment paths must lie in the data dir's `agent-images/` or
  `agent-files/` (the upload routes' output), else 400.
- The server builds the message from the stored report, never from the client:
  `[Status] <project name> · <title> (entry <id> | task <id>, refs <pr/issue urls>)`, an empty line, the
  owner's text, then one `[Image: <path>]` / `[File: <path>]` line per attachment.
- Delivery and errors exactly as answers (same target resolution; 409 with a clear message when the
  orchestrator is not running or unreachable; 404 for an unknown entry/task). Success:
  `201 { delivered: true }`.

### Module host (Orkumo → module UI, docs/MODULES.md)

- `host.instruct({ orchestrator, orchestratorName, entry?, task?: { project, task }, title, project })`
  opens Orkumo's Instruct dialog: text, paste / drag-and-drop images, file picker (agents-ui
  `ImageAttachments`, `imageDropHandlers`, `attachableFiles`; upload via the existing
  `uploadAttachment`). It shows the context header it will send, then sending → delivered / error
  (the server's message, e.g. orchestrator offline). Esc / Cancel closes.

### Status module UI (DevHub-pro `src/status`)

- Inbox card and task row: a disclosure "Details" when `description` or chat context exists; it
  expands the description (Markdown) and, under it, "From the chat, <time>" with the context
  (Markdown, collapsed by default).
- Markdown: escape first, then a small subset (paragraphs, headings, lists, bold, italic, inline
  code, code blocks, links via `safeUrl` https only). No raw HTML ever.
- The project column never shows "–": entry without `projectId` → the project of its `taskId`;
  neither → "No project".
- "Instruct" button on every inbox card and every task row that has a reporting orchestrator; it
  calls `host.instruct` (hidden when the host has none). Works in the pane view too.

### Orchestrator guide

`agents.md` (Status report section), `skill.md` (report), `status-report.md`: titles short;
`description` as detailed as the chat (starting point, what was done, what is open, options with
consequences, recommendation with reason); every "for you" point in the chat is exactly one inbox
entry with the same wording (PR merge = `approval` with `pr`, deploy question = `decision`, setting
a key = `todo`), order in `detail`; `projectId` always (`general` for items without a project).

## Acceptance

- AC-12: a card with a long description shows one short line; Details shows the full Markdown;
  links work, HTML stays text (test plus browser).
- AC-13: after the orchestrator's turn ends, new/changed items carry its last answer as chat
  context with the time; unchanged items keep theirs (test plus browser with a fixture transcript).
- AC-14: a report entry without or with an unknown `projectId` is refused with the hint; stored
  old reports still render with the project derived from `taskId` (tests).
- AC-15: Instruct from a card with an image arrives in the orchestrator pane as header + text +
  `[Image: …]`; an offline orchestrator shows the server's error in the dialog (tests plus browser).
- AC-16: guide, skill and `/status-report` carry the rules above (test on the rendered files).
