import fs from 'fs';
import os from 'os';
import path from 'path';

const HOME = os.homedir();
const CONFIG_FILES = [
  path.join(HOME, '.config/ghostty/config.ghostty'),
  path.join(HOME, '.config/ghostty/config'),
  path.join(HOME, 'Library/Application Support/com.mitchellh.ghostty/config.ghostty'),
  path.join(HOME, 'Library/Application Support/com.mitchellh.ghostty/config'),
];
const THEME_DIRS = [
  path.join(HOME, '.config/ghostty/themes'),
  '/Applications/Ghostty.app/Contents/Resources/ghostty/themes',
];
const ANSI = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];
const COLOR_KEYS = {
  background: 'background',
  foreground: 'foreground',
  'cursor-color': 'cursor',
  'cursor-text': 'cursorAccent',
  'selection-background': 'selectionBackground',
  'selection-foreground': 'selectionForeground',
};
const MAX_INCLUDE_DEPTH = 5;

// shortcut: hex colors only, X11 color names are ignored
const toHex = (v) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  return m ? `#${m[1].toLowerCase()}` : null;
};

const unquote = (v) => v.replace(/^"(.*)"$/, '$1');

/** Parse `key = value` lines into [key, value] pairs (repeatable keys keep order). */
export function parseEntries(text) {
  const entries = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    entries.push([line.slice(0, eq).trim(), unquote(line.slice(eq + 1).trim())]);
  }
  return entries;
}

const readSafe = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** Collect entries of a file, expanding `config-file` includes in place. Records files for mtime checks. */
function collectEntries(file, files, depth = 0) {
  files.add(file); // tracked even when missing, so creating it invalidates the cache
  const text = readSafe(file);
  if (text === null || depth > MAX_INCLUDE_DEPTH) return [];
  const out = [];
  for (const [key, value] of parseEntries(text)) {
    if (key !== 'config-file') {
      out.push([key, value]);
      continue;
    }
    const target = path.resolve(path.dirname(file), value.replace(/^\?/, ''));
    out.push(...collectEntries(target, files, depth + 1));
  }
  return out;
}

function resolveTheme(entries, files) {
  const value = entries.filter(([k]) => k === 'theme').pop()?.[1];
  if (!value) return [];
  // `light:a,dark:b` - the dashboard is dark
  const parts = Object.fromEntries(
    value.split(',').map((p) => p.trim().split(/:(.*)/s).slice(0, 2))
  );
  const name = parts.dark || parts.light || value;
  const candidates = path.isAbsolute(name)
    ? [name]
    : /[\\/]/.test(name)
      ? []
      : THEME_DIRS.map((d) => path.join(d, name));
  for (const file of candidates) {
    const themed = collectEntries(file, files);
    if (themed.length) return themed;
  }
  return [];
}

/** Map resolved entries (later wins) to the xterm-oriented result. */
export function buildResult(entries) {
  const theme = {};
  let fontFamily = null;
  let fontSize = null;
  let cursorStyle = null;
  let cursorBlink = null;
  for (const [key, value] of entries) {
    if (COLOR_KEYS[key]) {
      const hex = toHex(value);
      if (hex) theme[COLOR_KEYS[key]] = hex;
    } else if (key === 'palette') {
      const m = /^(\d+)\s*=\s*(.+)$/.exec(value);
      const hex = m && toHex(m[2].trim());
      if (hex && +m[1] < ANSI.length) theme[ANSI[+m[1]]] = hex;
    } else if (key === 'font-family') {
      if (fontFamily === null && value) fontFamily = value; // first entry wins, the rest are fallbacks
    } else if (key === 'font-size') {
      const n = parseFloat(value);
      if (n > 0) fontSize = n;
    } else if (key === 'cursor-style') {
      if (value === 'block_hollow') cursorStyle = 'block';
      else if (['block', 'bar', 'underline'].includes(value)) cursorStyle = value;
    } else if (key === 'cursor-style-blink') {
      if (value === 'true' || value === 'false') cursorBlink = value === 'true';
    }
  }
  return { theme, fontFamily, fontSize, cursorStyle, cursorBlink };
}

let cache = null; // { configFiles, files, stamp, result }

const stampOf = (files) =>
  [...files]
    .map((f) => `${f}:${fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs ?? 0}`)
    .join('|');

/** Resolve the user's Ghostty config; cached until any involved file changes. */
export function getGhosttyConfig(configFiles = CONFIG_FILES) {
  if (cache && cache.configFiles === configFiles && stampOf(cache.files) === cache.stamp) {
    return cache.result;
  }
  const files = new Set();
  const user = configFiles.flatMap((f) => collectEntries(f, files));
  const source = configFiles.find((f) => readSafe(f) !== null) ?? null;
  // theme first so explicit user keys win
  const result = {
    found: source !== null,
    ...buildResult([...resolveTheme(user, files), ...user]),
    source,
  };
  cache = { configFiles, files, stamp: stampOf(files), result };
  return result;
}
