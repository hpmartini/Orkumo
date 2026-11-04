import { Boxes, Layers, Puzzle, Sparkles, Workflow, type LucideIcon } from 'lucide-react';

// Allowlist from docs/MODULES.md: a module cannot pull arbitrary icons into the host bundle
const ICONS = new Map<string, LucideIcon>([
  ['Workflow', Workflow],
  ['Puzzle', Puzzle],
  ['Boxes', Boxes],
  ['Sparkles', Sparkles],
  ['Layers', Layers],
]);

/** Lucide icon of a module mode; unknown or missing names fall back to Puzzle */
export const moduleIcon = (name?: string): LucideIcon => (name && ICONS.get(name)) || Puzzle;
