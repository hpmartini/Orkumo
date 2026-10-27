# Optional Modules

At start the server loads optional modules from a directory. No directory, no modules: no routes, no UI, nothing in the build changes. Modules are how separately distributed features plug into DevHub without touching this repo.

## Location

`DEVHUB_PREMIUM_DIR` if set, otherwise `<dataPath>/modules`:

| Mode | Default |
|:-----|:--------|
| Dev / standalone | `data/modules` (gitignored via `data/`) |
| Electron | `<userData>/modules` |

The default is not cwd-relative (packaged Electron starts with cwd `/`). To use a checkout elsewhere, put it in `.env.local`:

```sh
DEVHUB_PREMIUM_DIR=/path/to/modules   # contains one subdirectory per module
```

## Layout and contract

One subdirectory per module with an `index.js` (ESM; the module needs `"type": "module"` in its own `package.json`):

```js
export default {
  id: 'my-module',        // /^[a-z0-9-]+$/, unique; becomes the URL segment
  name: 'My Module',
  ui: './ui.js',          // optional, path inside the module directory
  async register(ctx) {}, // may be async
};
```

`ctx`:

| Field | Content |
|:------|:--------|
| `id`, `dir` | the module id and its directory |
| `router` | Express router mounted at `/api/modules/<id>` |
| `services` | `agentService`, `boardService`, `db: { getDb, isDatabaseConnected }` |
| `logger` | `info`/`warn`/`error`, prefixed `[module:<id>]` |

Modules must not import host packages (`express`, ...): the Electron bundle has no `node_modules` for them. Everything the host offers comes through `ctx`; a module with its own dependencies bundles them.

## API

- `GET /api/modules` -> `[{ id, name, ui }]` (`ui`: boolean). `[]` without modules.
- `GET /api/modules/<id>/ui.js` is reserved for the module's UI bundle (only if `ui` is set).

## Frontend

The shell renders `ModuleSlot` (`components/ModuleSlot.tsx`). For each module with `ui` it does `import('/api/modules/<id>/ui.js')` and calls the export:

```js
export function mount(el) {   // el: an empty div owned by the module
  // render with any framework into el
  return () => {};            // optional cleanup, called on unmount
}
```

`mount(el)` instead of a React component on purpose: a bundled module ships its own React copy, and hooks across two React instances crash. Without modules the slot renders nothing. In Electron the import is cross-origin (`file://` -> `localhost`); the server's CORS setup allows it.

## Failure behavior

Import errors, validation errors (bad/duplicate id, `ui` outside the module directory) and exceptions in `register` are logged as `[Modules]` errors and the module is skipped. Its routes are mounted only after `register` succeeded, so a failed module leaves no route. A `register` that never resolves delays server start; there is no timeout.

## Security

Modules run with full server rights. The trust boundary is write access to the modules directory; only load code you trust. `data/modules` is in `.dockerignore` so module code never lands in an image build context.

## Development

`test/fixtures/premium/placeholder` is an empty module that only registers itself. Load it with `DEVHUB_PREMIUM_DIR=$PWD/test/fixtures/premium bun run server` (the `broken-*` siblings there exercise the error path and log errors).
