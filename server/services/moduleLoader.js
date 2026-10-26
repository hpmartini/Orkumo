/**
 * Module Loader
 *
 * Loads optional modules from a directory at server start. One subdirectory per
 * module, each with an index.js whose default export is
 * { id, name, register(ctx), ui? }. See docs/MODULES.md for the contract.
 *
 * A module that fails to load is logged and skipped; load() never throws.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { getDataPath } from './dataPath.js';

// Same pattern as ideIdSchema in server/index.js; the id becomes a URL segment.
const MODULE_ID = /^[a-z0-9-]+$/;

/**
 * Directory modules are loaded from: DEVHUB_PREMIUM_DIR, else <dataPath>/modules.
 * Not cwd-relative: the packaged Electron app starts with cwd '/'.
 */
export function getModulesDir() {
  return process.env.DEVHUB_PREMIUM_DIR || path.join(getDataPath(), 'modules');
}

function createLogger(prefix) {
  return {
    info: (...args) => console.log(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
  };
}

/**
 * @param {{ services: object, logger?: object }} options services are handed to modules as ctx.services
 * @returns {{ router: import('express').Router, load: (dir: string) => Promise<object[]> }}
 *   router is mounted once, synchronously; load() attaches module routers later (Express resolves
 *   the router stack per request, so routes added after mounting still match).
 */
export function createModuleHost({ services, logger = createLogger('[Modules]') }) {
  const router = express.Router();
  const loaded = [];

  router.get('/', (_req, res) => {
    res.json(loaded.map(({ id, name, ui }) => ({ id, name, ui: Boolean(ui) })));
  });

  async function loadOne(dir, entry) {
    const moduleDir = path.join(dir, entry);
    const mod = (await import(pathToFileURL(path.join(moduleDir, 'index.js')).href)).default;

    if (!mod || typeof mod !== 'object') throw new Error('default export must be an object');
    if (typeof mod.id !== 'string' || !MODULE_ID.test(mod.id)) {
      throw new Error(`invalid id ${JSON.stringify(mod.id)} (allowed: ${MODULE_ID})`);
    }
    if (loaded.some((m) => m.id === mod.id)) throw new Error(`duplicate id "${mod.id}"`);
    if (typeof mod.name !== 'string' || !mod.name) throw new Error('name must be a string');
    if (typeof mod.register !== 'function') throw new Error('register must be a function');

    const moduleRouter = express.Router();
    let uiFile = null;
    if (mod.ui !== undefined) {
      if (typeof mod.ui !== 'string') throw new Error('ui must be a path string');
      uiFile = path.resolve(moduleDir, mod.ui);
      if (!uiFile.startsWith(path.resolve(moduleDir) + path.sep)) {
        throw new Error('ui must be inside the module directory');
      }
      // root option: an absolute path through a dot-directory (e.g. ~/.config) would 404
      const uiRel = path.relative(moduleDir, uiFile);
      moduleRouter.get('/ui.js', (_req, res) => res.sendFile(uiRel, { root: moduleDir }));
    }

    await mod.register({
      id: mod.id,
      dir: moduleDir,
      router: moduleRouter,
      services,
      logger: createLogger(`[module:${mod.id}]`),
    });

    // Mount only after register succeeded: a failing module leaves no route behind.
    router.use(`/${mod.id}`, moduleRouter);
    loaded.push({ id: mod.id, name: mod.name, ui: uiFile });
  }

  async function load(dir) {
    if (!fs.existsSync(dir)) return [];

    let entries = [];
    try {
      entries = fs.readdirSync(dir).sort();
    } catch (error) {
      logger.error(`Cannot read ${dir}:`, error);
      return [];
    }

    for (const entry of entries) {
      if (!fs.existsSync(path.join(dir, entry, 'index.js'))) continue;
      try {
        await loadOne(dir, entry);
        logger.info(`Loaded module "${loaded[loaded.length - 1].id}" from ${entry}`);
      } catch (error) {
        logger.error(`Skipping module in ${entry}:`, error);
      }
    }
    return loaded.map(({ id, name }) => ({ id, name }));
  }

  return { router, load };
}
