import { useEffect, useState } from 'react';
import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { API_BASE_URL } from '../utils/apiConfig';

export interface GhosttyConfig {
  found: boolean;
  theme: ITheme;
  fontFamily: string | null;
  fontSize: number | null;
  cursorStyle: 'block' | 'bar' | 'underline' | null;
  cursorBlink: boolean | null;
  source: string | null;
}

export const DEFAULT_TERMINAL_OPTIONS = {
  theme: {
    background: '#0a0a0f',
    foreground: '#e4e4e7',
    cursor: '#60a5fa',
    cursorAccent: '#0a0a0f',
    selectionBackground: '#3b82f680',
    black: '#18181b',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    blue: '#3b82f6',
    magenta: '#a855f7',
    cyan: '#06b6d4',
    white: '#e4e4e7',
    brightBlack: '#52525b',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#facc15',
    brightBlue: '#60a5fa',
    brightMagenta: '#c084fc',
    brightCyan: '#22d3ee',
    brightWhite: '#fafafa',
  } as ITheme,
  fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  cursorStyle: 'bar' as 'block' | 'bar' | 'underline',
  cursorBlink: true,
};

// Fetched once per page load; null while loading or when the server has no Ghostty config
let cached: GhosttyConfig | null = null;
let request: Promise<void> | null = null;
const listeners = new Set<(config: GhosttyConfig) => void>();

function load() {
  request ??= fetch(`${API_BASE_URL}/terminal/ghostty`)
    .then((res) => (res.ok ? res.json() : null))
    .then((config: GhosttyConfig | null) => {
      if (!config?.found) return;
      cached = config;
      listeners.forEach((fn) => fn(config));
    })
    .catch(() => {
      // Ghostty theming is optional; keep the defaults
    });
}

export function useGhosttyTheme(): GhosttyConfig | null {
  const [config, setConfig] = useState(cached);
  useEffect(() => {
    if (cached) return;
    listeners.add(setConfig);
    load();
    return () => {
      listeners.delete(setConfig);
    };
  }, []);
  return config;
}

/** Overlay the Ghostty config on terminal defaults, falling back per key. */
export function withGhostty(
  defaults: Required<
    Pick<ITerminalOptions, 'theme' | 'fontFamily' | 'fontSize' | 'cursorStyle' | 'cursorBlink'>
  >,
  ghostty: GhosttyConfig | null
) {
  if (!ghostty) return defaults;
  return {
    theme: { ...defaults.theme, ...ghostty.theme },
    // keep the defaults as fallbacks behind the Ghostty font
    fontFamily: ghostty.fontFamily
      ? `"${ghostty.fontFamily}", ${defaults.fontFamily}`
      : defaults.fontFamily,
    fontSize: ghostty.fontSize ?? defaults.fontSize,
    cursorStyle: ghostty.cursorStyle ?? defaults.cursorStyle,
    cursorBlink: ghostty.cursorBlink ?? defaults.cursorBlink,
  };
}
