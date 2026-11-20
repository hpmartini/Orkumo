/**
 * Module Loader
 *
 * Loads optional modules from a directory at server start and again on reload(). One subdirectory
 * per module, each with an index.js whose default export is
 * { id, name, register(ctx), ui?, mode?, workflow? }. See docs/MODULES.md for the contract,
 * docs/WORKFLOW_PROVIDER.md for `workflow`.
 *
 * A module that fails to load is logged and skipped; load() never throws.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { getDataPath } from './dataPath.js';
import { getProvider, setProvider, validateProvider } from './workflowProvider.js';
import { addAuthorizer, getServeSecret, isViaServe } from './remoteAccess.js';

// Same pattern as ideIdSchema in server/index.js; the id becomes a URL segment.
const MODULE_ID = /^[a-z0-9-]+$/;
// Host routes; a module mode at /<id> would shadow them.
const RESERVED_IDS = new Set([
  'dashboard',
  'usage',
  'agents',
  'board',
  'issues',
  'code',
  'pulls',
  'api',
  'assets',
]);

/**
 * Directories modules are loaded from: DEVHUB_PREMIUM_DIR (a path list, `:`-separated like PATH),
 * else <dataPath>/modules. Not cwd-relative: the packaged Electron app starts with cwd '/'.
 */
export function getModulesDir() {
  return process.env.DEVHUB_PREMIUM_DIR || path.join(getDataPath(), 'modules');
}

/** Validated `mode` of a module (only the documented fields), or undefined */
function parseMode({ mode, ui }) {
  if (mode === undefined) return undefined;
  if (!mode || typeof mode !== 'object') throw new Error('mode must be an object');
  if (ui === undefined) throw new Error('mode needs ui');
  const { label, icon, keywords, scoped, orchestratorFilter } = mode;
  if (typeof label !== 'string' || !label.trim()) throw new Error('mode.label must be a string');
  if (icon !== undefined && typeof icon !== 'string') throw new Error('mode.icon must be a string');
  if (keywords !== undefined && typeof keywords !== 'string') {
    throw new Error('mode.keywords must be a string');
  }
  if (scoped !== undefined && typeof scoped !== 'boolean') {
    throw new Error('mode.scoped must be a boolean');
  }
  if (orchestratorFilter !== undefined && typeof orchestratorFilter !== 'boolean') {
    throw new Error('mode.orchestratorFilter must be a boolean');
  }
  return { label, icon, keywords, scoped, orchestratorFilter };
}

// Places in the host UI a module without `mode` may render into (docs/MODULES.md, Slots).
const SLOTS = new Set(['agents-rail']);

function parseSlot({ slot, ui, mode }) {
  if (slot === undefined) return undefined;
  if (!SLOTS.has(slot)) throw new Error(`slot must be one of ${[...SLOTS].join(', ')}`);
  if (ui === undefined) throw new Error('slot needs ui');
  if (mode !== undefined) throw new Error('slot and mode exclude each other');
  return slot;
}

function createLogger(prefix) {
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

// A dispose step that never settles must not block the next load
const DISPOSE_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `version` of the module's package.json, or null */
function readVersion(moduleDir) {
  try {
    const { version } = JSON.parse(fs.readFileSync(path.join(moduleDir, 'package.json'), 'utf8'));
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ services: object, logger?: object, isAdmin?: (req) => boolean }} options services are
 *   handed to modules as ctx.services; isAdmin gates the status and reload routes (owner only)
 * @returns {{ router: import('express').Router, load: (dir: string) => Promise<object[]>,
 *   reload: () => Promise<object[]>, upgradeHandler: (id: string) => Function | undefined }}
 *   router is mounted once, synchronously; it dispatches to the routers of the current module
 *   generation, which reload() replaces.
 */
export function createModuleHost({
  services,
  logger = createLogger('[Modules]'),
  isAdmin = () => false,
}) {
  const router = express.Router();
  // Current generation: module records { id, name, ui, mode, slot, dispose }, their routers, upgrades
  let loaded = [];
  let modules = express.Router();
  let upgradeHandlers = new Map();
  // One row per module directory of the last load: { entry, id?, name?, version, status, error? }
  let results = [];
  let dirsLoaded = null;
  let generation = 0;
  // Loads and reloads run one after another
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  };

  router.get('/', (_req, res) => {
    res.json(
      loaded.map(({ id, name, ui, mode, slot }) => ({
        id,
        name,
        ui: Boolean(ui),
        ...(mode && { mode }),
        ...(slot && { slot }),
      }))
    );
  });

  // `_` cannot start a module id (MODULE_ID), so these never shadow a module route
  const ownerOnly = (req, res, next) =>
    isAdmin(req) ? next() : res.status(403).json({ error: 'Local only' });
  router.get('/_status', ownerOnly, (_req, res) => res.json(results));
  router.post('/_reload', ownerOnly, async (_req, res) => {
    try {
      res.json(await reload());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.use((req, res, next) => modules(req, res, next));

  async function loadOne(dir, entry) {
    const moduleDir = path.join(dir, entry);
    // A new URL per generation: Node caches ES modules per URL, so a reload re-evaluates index.js
    const url = `${pathToFileURL(path.join(moduleDir, 'index.js')).href}?v=${generation}`;
    const mod = (await import(url)).default;
    if (!mod || typeof mod !== 'object') throw new Error('default export must be an object');
    if (typeof mod.id !== 'string' || !MODULE_ID.test(mod.id)) {
      throw new Error(`invalid id ${JSON.stringify(mod.id)} (allowed: ${MODULE_ID})`);
    }
    if (RESERVED_IDS.has(mod.id)) throw new Error(`id "${mod.id}" is reserved by the host`);
    if (loaded.some((m) => m.id === mod.id)) throw new Error(`duplicate id "${mod.id}"`);
    if (typeof mod.name !== 'string' || !mod.name) throw new Error('name must be a string');
    if (typeof mod.register !== 'function') throw new Error('register must be a function');
    const mode = parseMode(mod);
    const slot = parseSlot(mod);
    if (mod.workflow !== undefined) {
      if (getProvider())
        throw new Error(`a workflow provider is already loaded (${getProvider().name})`);
      validateProvider(mod.workflow);
    }

    const moduleRouter = express.Router();
    let uiFile = null;
    if (mod.ui !== undefined) {
      if (typeof mod.ui !== 'string') throw new Error('ui must be a path string');
      // realpath: a lexical check would let a symlinked ui file (or module dir) serve files outside; throws if missing
      const realDir = fs.realpathSync(moduleDir);
      uiFile = fs.realpathSync(path.resolve(moduleDir, mod.ui));
      if (!uiFile.startsWith(realDir + path.sep)) {
        throw new Error('ui must be inside the module directory');
      }
      // root option: an absolute path through a dot-directory (e.g. ~/.config) would 404
      const uiRel = path.relative(realDir, uiFile);
      moduleRouter.get('/ui.js', (_req, res) => res.sendFile(uiRel, { root: realDir }));
    }

    let onUpgrade = null;
    const authorizers = [];
    const disposers = [];
    const runDisposers = async () => {
      for (const fn of disposers.reverse()) {
        try {
          await withTimeout(Promise.resolve().then(fn), DISPOSE_TIMEOUT_MS, 'dispose');
        } catch (error) {
          logger.error(`Dispose of module "${mod.id}" failed:`, error);
        }
      }
    };
    const ctx = {
      id: mod.id,
      dir: moduleDir,
      dataDir: path.join(getDataPath(), 'module-data', mod.id),
      router: moduleRouter,
      services,
      logger: createLogger(`[module:${mod.id}]`),
      onUpgrade(handler) {
        if (typeof handler !== 'function') throw new Error('onUpgrade needs a function');
        onUpgrade = handler;
      },
      addAuthorizer(fn) {
        if (typeof fn !== 'function') throw new Error('addAuthorizer needs a function');
        authorizers.push(fn);
      },
      onDispose(fn) {
        if (typeof fn !== 'function') throw new Error('onDispose needs a function');
        disposers.push(fn);
      },
      isViaServe,
      serveSecret: getServeSecret,
    };
    try {
      await mod.register(ctx);
    } catch (error) {
      // What register started before it failed (timers, watchers) ends here
      await runDisposers();
      throw error;
    }

    // Mount only after register succeeded: a failing module leaves no route or hook behind.
    modules.use(`/${mod.id}`, moduleRouter);
    if (onUpgrade) upgradeHandlers.set(mod.id, onUpgrade);
    const removeAuthorizers = authorizers.map(addAuthorizer);
    if (mod.workflow !== undefined) setProvider(mod.workflow);
    const dispose = async () => {
      removeAuthorizers.forEach((remove) => remove());
      if (mod.workflow !== undefined) setProvider(null);
      await runDisposers();
    };
    loaded.push({ id: mod.id, name: mod.name, ui: uiFile, mode, slot, dispose });
  }

  /** Ends the current generation: hooks off, routes gone, dispose callbacks run (last loaded first) */
  async function unloadAll() {
    const old = loaded;
    loaded = [];
    modules = express.Router();
    upgradeHandlers = new Map();
    results = [];
    generation += 1;
    for (const m of old.reverse()) {
      await m.dispose();
      logger.info(`Unloaded module "${m.id}"`);
    }
  }

  async function loadDirs(dirs) {
    dirsLoaded = dirs;
    for (const dir of String(dirs).split(path.delimiter).filter(Boolean)) await loadDir(dir);
  }

  /** Loads every module of `dirs` (one directory or a path list), in list order */
  const load = (dirs) =>
    serialized(async () => {
      await loadDirs(dirs);
      return loaded.map(({ id, name }) => ({ id, name }));
    });

  /**
   * Unloads every module and loads the directories of the last load() again, without a restart.
   * @returns per module directory { entry, id?, name?, version, status: 'loaded'|'error', error? }
   */
  const reload = () =>
    serialized(async () => {
      await unloadAll();
      if (dirsLoaded !== null) await loadDirs(dirsLoaded);
      return results;
    });

  async function loadDir(dir) {
    if (!fs.existsSync(dir)) return;

    let entries = [];
    try {
      entries = fs.readdirSync(dir).sort();
    } catch (error) {
      logger.error(`Cannot read ${dir}:`, error);
      return;
    }

    for (const entry of entries) {
      if (!fs.existsSync(path.join(dir, entry, 'index.js'))) continue;
      const version = readVersion(path.join(dir, entry));
      try {
        await loadOne(dir, entry);
        const { id, name } = loaded[loaded.length - 1];
        results.push({ entry, id, name, version, status: 'loaded' });
        logger.info(`Loaded module "${id}" from ${entry}`);
      } catch (error) {
        results.push({ entry, version, status: 'error', error: String(error?.message ?? error) });
        logger.error(`Skipping module in ${entry}:`, error);
      }
    }
  }

  /** WebSocket upgrade handler of module `id` (ctx.onUpgrade), or undefined */
  const upgradeHandler = (id) => upgradeHandlers.get(id);

  return { router, load, reload, upgradeHandler };
}
