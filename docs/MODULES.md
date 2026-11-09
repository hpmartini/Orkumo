# Optional Modules

At start the server loads optional modules from a directory. No directory, no modules: no routes, no UI, nothing in the build changes. Modules are how separately distributed features plug into Orkumo without touching this repo.

## Location

`DEVHUB_PREMIUM_DIR` if set, otherwise `<dataPath>/modules`:

| Mode             | Default                                 |
| :--------------- | :-------------------------------------- |
| Dev / standalone | `data/modules` (gitignored via `data/`) |
| Electron         | `<userData>/modules`                    |

The default is not cwd-relative (packaged Electron starts with cwd `/`). To use a checkout elsewhere, put it in `.env.local`:

```sh
DEVHUB_PREMIUM_DIR=/path/to/modules   # contains one subdirectory per module
```

## Layout and contract

One subdirectory per module with an `index.js` (ESM; the module needs `"type": "module"` in its own `package.json`):

```js
export default {
  id: 'my-module', // /^[a-z0-9-]+$/, unique; becomes the URL segment
  name: 'My Module',
  ui: './ui.js', // optional, path inside the module directory
  mode: { label: 'My Module', icon: 'Puzzle', keywords: 'search words', scoped: false }, // optional, needs ui
  slot: 'agents-rail', // optional, needs ui, excludes mode: where the UI renders (see Slots)
  async register(ctx) {}, // may be async
};
```

Ids of host routes (`dashboard`, `usage`, `agents`, `board`, `code`, `pulls`) are reserved: a module with such an id is skipped.

### Modes

A module with `mode` brings its own work mode, like Board or Code:

| Field      | Content                                                                                                                                                |
| :--------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| route      | `/<id>`; the shell keeps the module UI mounted and tells it whether the mode is visible                                                                |
| `label`    | name in the title-bar toggles, the agents rail and the command palette (`Open <label>`)                                                                |
| `icon`     | optional lucide icon name from the host allowlist (`Workflow`, `Puzzle`, `Boxes`, `Sparkles`, `Layers`); unknown or missing -> `Puzzle`                |
| `keywords` | optional palette search words                                                                                                                          |
| `scoped`   | optional; `true` adds `View <label>` to a repo group and `Show <label>` to an agent with board issues, opening `/<id>?repo=owner/name[&agent=<jobId>]` |

Without the module there is no route, no toggle, no palette entry, no rail entry; `/<id>` redirects to `/dashboard` like any unknown path (`/` itself opens `/agents`).

`ctx`:

| Field                | Content                                                                                                                     |
| :------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `id`, `dir`          | the module id and its directory                                                                                             |
| `dataDir`            | `<dataPath>/module-data/<id>` for the module's own files; not created by the host                                           |
| `router`             | Express router mounted at `/api/modules/<id>`                                                                               |
| `services`           | see below                                                                                                                   |
| `logger`             | `info`/`warn`/`error`, prefixed `[module:<id>]`                                                                             |
| `onUpgrade(handler)` | WebSocket upgrades under `/api/modules/<id>/...` go to `handler(req, socket, head)` (Node `upgrade` event arguments)        |
| `addAuthorizer(fn)`  | sync `fn(req)`; `=== true` lets a non-local request in without the pairing token (only matters with `DEVORBIT_REMOTE=true`) |

`onUpgrade` and `addAuthorizer` take effect only after `register` succeeded, like the routes.

### WebSocket upgrades

The server has one `upgrade` dispatcher. It refuses a browser `Origin` that is neither a CORS origin nor the page's own host (`403`; browsers apply no CORS to WebSockets), then applies the same check as HTTP requests (`remoteAccess.isAuthorized`: local request, pairing token or a module authorizer; otherwise `401`), then routes `/api/pty` to the host PTY server and `/api/modules/<id>/...` to that module's `onUpgrade` handler; anything else gets `404`. The handler owns the socket: it either completes the handshake (e.g. relays it raw to another server) or writes an HTTP error and destroys the socket. A throwing handler gets `500`.

### Authorizers

An authorizer widens who may call the whole API, not only the module's routes, so it must be narrow and sync (it also runs for WebSocket upgrades). A throwing authorizer counts as a no. Example: the mesh module accepts a request that `tailscale serve` relayed for the machine owner's own tailnet login (`Tailscale-User-Login`, which serve overwrites on every request) from one of the owner's own devices (the last `X-Forwarded-For` hop, checked against `tailscale status`). Never trust an identity header alone: check it against a source the client cannot write. An identity header proves the device, not the page: also refuse cross-site browser requests (`Sec-Fetch-Site` other than `same-origin`/`none`, or an `Origin` without it), or any site open in the owner's browser can call the API (CSRF).

`ctx.services`:

| Service                        | Content                                                                                                                                                                                                                                                                                                                  |
| :----------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentService`, `boardService` | the host services (`agentService.listSessions`, `boardService.getBoard`, ...)                                                                                                                                                                                                                                            |
| `db`                           | `{ getDb, isDatabaseConnected }`                                                                                                                                                                                                                                                                                         |
| `getBoardSettings()`           | `{ source, ... }` board source from the admin settings                                                                                                                                                                                                                                                                   |
| `findRepoInKnownDirs(slug)`    | local checkout of `owner/name` in the configured project dirs, or throws                                                                                                                                                                                                                                                 |
| `getAgentContexts()`           | `{ [jobId]: AgentContext }` (repo, worktree, PRs of each agent)                                                                                                                                                                                                                                                          |
| `workflow`                     | workflow provider contract ([WORKFLOW_PROVIDER.md](WORKFLOW_PROVIDER.md)): `provider()` -> provider info or null, `context(itemId, { refresh })` -> `{ source, item, state }` (`state` = `item.workflow?.state ?? null`; 404 if not on the board), `start(url)` -> StartResult, `applyGo(ctx, go)` -> `{ status, body }` |
| `agentLimiter`, `validate`     | the host's rate limiter middleware and `validate(zodSchema)`; `zod` is the host's `z`, so module routes validate like host routes                                                                                                                                                                                        |
| `sendError(res, error)`        | error response with `error.status` (default 500)                                                                                                                                                                                                                                                                         |

Modules must not import host packages (`express`, ...): the Electron bundle has no `node_modules` for them. Everything the host offers comes through `ctx`; a module with its own dependencies bundles them.

## API

- `GET /api/modules` -> `[{ id, name, ui, mode?, slot? }]` (`ui`: boolean; `mode`: `{ label, icon?, keywords?, scoped? }`; `slot`: `'agents-rail'`). `[]` without modules.
- `GET /api/modules/<id>/ui.js` is reserved for the module's UI bundle (only if `ui` is set).

## Frontend

The shell renders `ModuleSlot` (`components/ModuleSlot.tsx`). For each module with `ui` it does `import('/api/modules/<id>/ui.js')` and calls the export:

```js
export function mount(el, host) {
  // el: an empty div owned by the module; render with any framework into el
  return {
    update(host) {}, // host state changed (mode shown/hidden, query string)
    unmount() {},
  };
  // a plain function return is still accepted as cleanup (no updates)
}
```

`host` (a fresh object on every `update`):

| Field                                                              | Content                                                                  |
| :----------------------------------------------------------------- | :----------------------------------------------------------------------- |
| `active`                                                           | the module's mode is visible (poll only while true); `true` for slot UIs |
| `search`                                                           | query string of the current route, e.g. `?repo=owner/name`               |
| `navigate(to)`, `setSearch(params)`                                | host router navigation; `setSearch({})` clears the query                 |
| `apiBase`                                                          | API base URL (`/api`, or absolute in Electron)                           |
| `toast.success(msg)`, `toast.error(msg)`                           | host toasts                                                              |
| `urls.code(path)`, `urls.board(repo, agent?)`, `urls.agent(jobId)` | routes of the host modes                                                 |
| `agentTarget`, `setAgentTarget(target)`                            | instance the AgentsView talks to, see Agent target                       |

Modules with `ui` but without `mode` or `slot` render in the shell's module slot (`components/ModuleSlot.tsx`); modes render in their own pane, slot UIs at their slot.

### Slots

| `slot`        | Place                                                                                               |
| :------------ | :-------------------------------------------------------------------------------------------------- |
| `agents-rail` | agents header, right after the mode switcher (the "Agents" label); inline, keep it one control high |

A slot UI gets the same `mount(el, host)` contract with `active: true`. Without a module with that slot nothing renders there.

### Agent target

`host.agentTarget` is `''` (this machine) or an API prefix of a module route, e.g. `/modules/mesh/peer/<host>` (`utils/agentTarget.ts`). With a prefix set, the AgentsView sends every `/api/agents/*` call to `/api<prefix>/agents/*` and opens agent PTYs at `/api<prefix>/pty` on the local server; the module relays them. The agent view settings (`/api/settings/agent-view`), Code mode, board and everything else stay local.

- `setAgentTarget(target)` accepts only `''` or `/modules/<id>/...` (`[A-Za-z0-9._~-]` segments); anything else is ignored. Every UI module gets a fresh host on a change.
- A session or chat id remembers the target it was first listed on: an open tab keeps talking to its instance after a switch, and a switch closes or re-attaches nothing. Tabs of other instances are not pruned while their instance is not picked.
- The prefix module answers `<prefix>/agents/*` like `/api/agents/*` and an upgrade at `<prefix>/pty` like `/api/pty`; it must refuse to relay to anything but the instances it knows.

`mount(el, host)` instead of a React component on purpose: a bundled module ships its own React copy, and hooks across two React instances crash. Without modules the slot renders nothing. In Electron the import is cross-origin (`file://` -> `localhost`); the server's CORS setup allows it.

## Failure behavior

Import errors, validation errors (bad/duplicate id, `ui` outside the module directory) and exceptions in `register` are logged as `[Modules]` errors and the module is skipped. Its routes are mounted only after `register` succeeded, so a failed module leaves no route. A `register` that never resolves delays server start; there is no timeout.

## Security

Module routes sit behind the host's global rate limiter; use `ctx.services.agentLimiter` and `validate` for anything that runs commands or reads files.

Modules run with full server rights. The trust boundary is write access to the modules directory; only load code you trust. `data/modules` is in `.dockerignore` so module code never lands in an image build context.

## Development

`test/fixtures/premium/placeholder` is an empty module that only registers itself; `test/fixtures/premium/with-mode` brings a mode. Load it with `DEVHUB_PREMIUM_DIR=$PWD/test/fixtures/premium bun run server` (the `broken-*` siblings there exercise the error path and log errors).

## Workflow provider

A module may declare `workflow` (at most one loaded module): see [WORKFLOW_PROVIDER.md](WORKFLOW_PROVIDER.md). `DEVHUB_PREMIUM_DIR` takes a `:`-separated path list, so a provider shipped by a workflow tool loads next to other modules.
