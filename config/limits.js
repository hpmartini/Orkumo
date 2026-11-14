/**
 * Limits the API enforces and the client plans for (no Node imports: the browser bundle reads
 * this file too).
 */

/** Prompt of `POST /api/agents/dispatch` (Claude Code `--bg`), in characters */
export const DISPATCH_PROMPT_MAX = 20000;

// the prompt travels in the ws URL: 1500 chars of 3-byte UTF-8 percent-encode to ~13.5 KB,
// below Node's 16 KB header limit, so a too-long prompt gets this error instead of a 431
/** Start prompt of a non-Claude harness (`-- <prompt>`, config/harnesses.js) */
export const MAX_HARNESS_PROMPT = 1500;

/** Files a composer attaches besides images (#19 AK-3): PDF, text and code */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** Extensions of attachable files (lower case, without the dot); the server checks the content */
export const ATTACHMENT_EXTENSIONS = Object.freeze([
  'pdf',
  // text and data
  'txt',
  'md',
  'markdown',
  'rst',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'svg',
  'sql',
  'diff',
  'patch',
  // code
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'mts',
  'cts',
  'tsx',
  'vue',
  'svelte',
  'py',
  'rb',
  'php',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'swift',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'scala',
  'dart',
  'lua',
  'r',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'gradle',
  'tf',
  'graphql',
  'proto',
]);
