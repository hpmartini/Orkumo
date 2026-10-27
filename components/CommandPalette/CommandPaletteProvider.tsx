import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { PaletteCommand } from '../../utils/commandPalette';
import { CommandPalette } from './CommandPalette';

interface PaletteApi {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  /** Replace the commands of one source; returns the unregister function */
  register: (sourceId: string, commands: PaletteCommand[]) => () => void;
}

const PaletteContext = createContext<PaletteApi | null>(null);

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
export const PALETTE_SHORTCUT = isMac ? '⌘P' : 'Ctrl+P';

export function useCommandPalette(): PaletteApi {
  const api = useContext(PaletteContext);
  if (!api) throw new Error('useCommandPalette needs a CommandPaletteProvider');
  return api;
}

/** Register commands for as long as the calling component is mounted. Memoize `commands`. */
export function useRegisterCommands(sourceId: string, commands: PaletteCommand[]): void {
  const { register } = useCommandPalette();
  useEffect(() => register(sourceId, commands), [register, sourceId, commands]);
}

export const CommandPaletteProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const sources = useRef(new Map<string, PaletteCommand[]>());

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const register = useCallback((sourceId: string, commands: PaletteCommand[]) => {
    sources.current.set(sourceId, commands);
    setVersion((v) => v + 1);
    return () => {
      if (sources.current.get(sourceId) === commands) sources.current.delete(sourceId);
    };
  }, []);
  // version in deps: a new function identity re-snapshots an open palette after late registrations
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getCommands = useCallback(() => [...sources.current.values()].flat(), [version]);

  // Capture phase and no input/terminal exclusion: the palette must open from the xterm too
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      // Ctrl+P is readline/Claude Code history in a terminal; there the palette needs Ctrl+Shift+P
      const inTerminal = !isMac && (e.target as HTMLElement | null)?.closest?.('.xterm');
      const chord = e.key.toLowerCase() === 'p' && (inTerminal ? e.shiftKey : !e.shiftKey);
      if (mod && !e.altKey && chord) {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(true);
      }
    };
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, []);

  const api = useMemo(() => ({ isOpen, open, close, register }), [isOpen, open, close, register]);

  return (
    <PaletteContext.Provider value={api}>
      {children}
      <CommandPalette open={isOpen} onClose={close} getCommands={getCommands} />
    </PaletteContext.Provider>
  );
};
