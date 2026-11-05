import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Files, GitBranch, Search, Settings, X } from 'lucide-react';
import { DEMO_ALTS, DEMO_PROJECTS } from '../copy';
import { cn } from '../lib/utils';

/** state is a mark as well as a hue: hollow ring, half ring, filled */
function StatusMark({ state }: { state: 'needs' | 'working' | 'done' }) {
  if (state === 'needs')
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
        <circle cx={6} cy={6} r={4} fill="none" stroke="#fb7185" strokeWidth={2} />
      </svg>
    );
  if (state === 'working')
    return (
      <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
        <circle
          cx={6}
          cy={6}
          r={4}
          fill="none"
          stroke="#fbbf24"
          strokeWidth={2.5}
          strokeDasharray="12.6 12.6"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0">
      <circle cx={6} cy={6} r={4} fill="#34d399" />
    </svg>
  );
}

/** token colours: k keyword, f function, s string, t type or number */
const TONE: Record<string, string> = {
  k: 'text-violet',
  f: 'text-link',
  s: 'text-emerald',
  t: 'text-amber',
};

/** split a marked source line into coloured spans */
function renderLine(line: string): ReactNode {
  return line.split(/(\{\w\|[^}]*\})/).map((part, i) => {
    const mark = /^\{(\w)\|(.*)\}$/.exec(part);
    if (!mark) return <span key={i}>{part}</span>;
    return (
      <span key={i} className={TONE[mark[1]]}>
        {mark[2]}
      </span>
    );
  });
}

const CART_LINES = [
  "{k|import} { {f|formatMoney} } {k|from} {s|'../lib/money'};",
  '',
  '{k|export interface} {t|CartLine} {',
  '  {t|sku}: {t|string};',
  '  {t|title}: {t|string};',
  '  {t|unitPrice}: {t|number};',
  '  {t|quantity}: {t|number};',
  '}',
  '',
  '{k|export function} {f|cartTotal}(lines: {t|CartLine}[]): {t|number} {',
  '  {k|const} total = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, {t|0});',
  '  {k|return} total;',
  '}',
  '',
  '{k|export function} {f|summarize}(lines: {t|CartLine}[]): {t|string} {',
  '  {k|return} {f|formatMoney}({f|cartTotal}(lines));',
  '}',
  '{k|export function} {f|applyDiscount}(total: {t|number}, percent: {t|number}): {t|number} {',
  '  {k|return} Math.round(total * (1 - percent / {t|100}));',
  '}',
];

const MONEY_LINES = [
  '{k|export function} {f|formatMoney}(cents: {t|number}): {t|string} {',
  "  {k|return} {s|'$'} + (cents / {t|100}).toFixed({t|2});",
  '}',
  '',
  '{k|export function} {f|parseMoney}(value: {t|string}): {t|number} {',
  "  {k|const} digits = value.replace(/[^0-9.]/g, '');",
  '  {k|return} Math.round(Number.parseFloat(digits) * 100);',
  '}',
  '',
  '{k|export function} {f|centsToUnits}(cents: {t|number}): {t|number} {',
  '  {k|return} Math.round(cents) / 100;',
  '}',
];

const PACKAGE_LINES = [
  '{',
  '  "name": {s|"storefront"},',
  '  "version": {s|"0.4.2"},',
  '  "scripts": {',
  '    "dev": {s|"vite"},',
  '    "build": {s|"tsc -b && vite build"},',
  '    "test": {s|"vitest run"}',
  '  },',
  '  "dependencies": {',
  '    "react": {s|"^19.2.0"},',
  '    "zod": {s|"^4.3.4"}',
  '  },',
  '  "devDependencies": {',
  '    "typescript": {s|"^5.8.2"},',
  '    "vite": {s|"^6.2.0"},',
  '    "vitest": {s|"^4.0.16"}',
  '  }',
  '}',
];

const README_LINES = [
  '# storefront',
  '',
  'The demo storefront behind the Orkumo landing page.',
  'Every file in it is synthetic.',
  '',
  '## Run it',
  '',
  '```bash',
  'bun install',
  'bun run dev',
  '```',
  '',
  'The dev server listens on port 3000.',
];

const FILES: Record<string, string[]> = {
  'src/app/cart.ts': CART_LINES,
  'src/lib/money.ts': MONEY_LINES,
  'package.json': PACKAGE_LINES,
  'README.md': README_LINES,
};

const CART_PATH = 'src/app/cart.ts';
const CART_BUG = 'Math.round(total';
const CART_BUG_INDEX = CART_LINES.findIndex((line) => line.includes(CART_BUG));
const CART_FIXED_LINE = '  return Math.max(0, Math.round(total * (1 - percent / 100)));';

type TreeNode =
  | { kind: 'folder'; name: string; path: string; children: TreeNode[] }
  | { kind: 'file'; name: string; path: string };

const TREE: TreeNode[] = [
  {
    kind: 'folder',
    name: 'src',
    path: 'src',
    children: [
      {
        kind: 'folder',
        name: 'app',
        path: 'src/app',
        children: [{ kind: 'file', name: 'cart.ts', path: CART_PATH }],
      },
      {
        kind: 'folder',
        name: 'lib',
        path: 'src/lib',
        children: [{ kind: 'file', name: 'money.ts', path: 'src/lib/money.ts' }],
      },
    ],
  },
  { kind: 'file', name: 'package.json', path: 'package.json' },
  { kind: 'file', name: 'README.md', path: 'README.md' },
];

const OPEN_FOLDERS: Record<string, boolean> = { src: true, 'src/app': true, 'src/lib': true };
const INITIAL_TABS = [CART_PATH];

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const nodeId = (path: string) => `code-demo-${path.replace(/\//g, '-')}`;

/** VS Code inside the app, abstracted to its essence */
export function CodeDemo() {
  const [project, setProject] = useState(DEMO_PROJECTS[0]);
  const [tabs, setTabs] = useState<string[]>(INITIAL_TABS);
  const [active, setActive] = useState(INITIAL_TABS[0]);
  const [folders, setFolders] = useState<Record<string, boolean>>(OPEN_FOLDERS);
  const [fixed, setFixed] = useState(false);

  const tabStripRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  const focusTabRef = useRef(false);

  /** the close button vanishes with its tab; hand the focus to the tab that stays active */
  useEffect(() => {
    if (!focusTabRef.current) return;
    focusTabRef.current = false;
    tabStripRef.current?.querySelector<HTMLButtonElement>(`[data-tab="${active}"]`)?.focus();
  }, [tabs, active]);

  /** "Apply fix" removes its own button; hand the focus to the status instead */
  useEffect(() => {
    if (fixed) statusRef.current?.focus();
  }, [fixed]);

  const openFile = (path: string) => {
    if (!tabs.includes(path)) setTabs([...tabs, path]);
    setActive(path);
  };

  const closeFile = (path: string) => {
    if (tabs.length <= 1) return;
    const next = tabs.filter((tab) => tab !== path);
    setTabs(next);
    if (path === active) setActive(next[next.length - 1]);
    focusTabRef.current = true;
  };

  const toggleFolder = (path: string) => setFolders((prev) => ({ ...prev, [path]: !prev[path] }));

  const lines =
    active === CART_PATH && fixed
      ? CART_LINES.map((line, i) => (i === CART_BUG_INDEX ? CART_FIXED_LINE : line))
      : (FILES[active] ?? []);

  const renderNodes = (nodes: TreeNode[]): ReactNode =>
    nodes.map((node) => {
      if (node.kind === 'folder') {
        const isOpen = folders[node.path] === true;
        return (
          <li key={node.path}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={nodeId(node.path)}
              onClick={() => toggleFolder(node.path)}
              className="flex w-full items-center gap-1 px-2 py-1 text-left font-mono text-[12px] text-muted transition-colors hover:bg-raised hover:text-text motion-reduce:transition-none"
            >
              {isOpen ? (
                <ChevronDown size={12} aria-hidden className="shrink-0" />
              ) : (
                <ChevronRight size={12} aria-hidden className="shrink-0" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
            <ul id={nodeId(node.path)} className={cn('pl-2', isOpen ? 'block' : 'hidden')}>
              {renderNodes(node.children)}
            </ul>
          </li>
        );
      }
      const isActive = node.path === active;
      return (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => openFile(node.path)}
            className={cn(
              'flex w-full items-center border-l-2 px-2 py-1 text-left font-mono text-[12px] transition-colors motion-reduce:transition-none',
              isActive
                ? 'border-blue text-text'
                : 'border-transparent text-muted hover:bg-raised hover:text-text'
            )}
          >
            <span className="truncate">{node.name}</span>
          </button>
        </li>
      );
    });

  return (
    <div role="group" aria-label={DEMO_ALTS.code} className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="label-tape text-muted">Code</span>
        <span className="label-tape text-muted">Interactive demo</span>
      </div>

      {/* top bar: the workspace, its project and the file picker */}
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-mono text-[12px] text-muted">{'</> Code'}</span>
          <span className="hidden min-w-0 truncate font-mono text-[12px] text-muted sm:inline">
            acme / {project}
          </span>
        </div>
        <select
          aria-label="Project"
          value={project}
          onChange={(event) => setProject(event.target.value)}
          className="max-w-[140px] shrink-0 rounded-[5px] border border-hairline bg-raised px-2 py-1 font-mono text-[12px] text-text transition-colors focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
        >
          {DEMO_PROJECTS.map((name) => (
            <option key={name} value={name} className="bg-raised text-text">
              {name}
            </option>
          ))}
        </select>
      </div>

      {/* workbench: activity bar, explorer, editor */}
      <div className="flex h-[420px] min-h-0">
        <div
          aria-hidden
          className="hidden w-9 shrink-0 flex-col items-center gap-4 border-r border-hairline bg-ground py-3 text-muted sm:flex"
        >
          <Files size={16} />
          <Search size={16} />
          <GitBranch size={16} />
          <Settings size={16} />
        </div>

        <div className="w-[120px] shrink-0 overflow-y-auto border-r border-hairline sm:w-[170px]">
          <div className="label-tape border-b border-hairline px-3 py-2 uppercase text-muted">
            {project}
          </div>
          <ul className="py-1">{renderNodes(TREE)}</ul>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* open files */}
          <div ref={tabStripRef} className="flex overflow-x-auto border-b border-hairline">
            {tabs.map((path) => {
              const isActive = path === active;
              const name = fileName(path);
              return (
                <div
                  key={path}
                  className={cn(
                    'flex shrink-0 items-center gap-1 border-r border-hairline pl-3 pr-1',
                    isActive ? 'bg-[#101a33]' : 'bg-ground'
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={isActive}
                    data-tab={path}
                    onClick={() => setActive(path)}
                    className={cn(
                      'py-2 font-mono text-[12px] transition-colors motion-reduce:transition-none',
                      isActive ? 'text-text' : 'text-muted hover:text-text'
                    )}
                  >
                    {name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${name}`}
                    disabled={tabs.length === 1}
                    onClick={() => closeFile(path)}
                    className="rounded-[3px] p-1 text-muted transition-colors hover:text-text disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>

          {/* the review finding on the open file */}
          {active === CART_PATH && (
            <div className="flex items-center justify-between gap-3 border-b border-hairline bg-panel px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <StatusMark state={fixed ? 'done' : 'needs'} />
                <span
                  ref={statusRef}
                  role="status"
                  tabIndex={-1}
                  className={cn('text-[13px]', fixed ? 'text-emerald' : 'text-text')}
                >
                  {fixed ? 'Fixed · ready to push' : 'Review: discount can go below zero'}
                </span>
              </div>
              {!fixed && (
                <button
                  type="button"
                  onClick={() => setFixed(true)}
                  className="shrink-0 rounded-[5px] border border-hairline px-2.5 py-1 text-[12px] text-text transition-colors hover:border-link hover:bg-raised focus-visible:outline-2 focus-visible:outline-link motion-reduce:transition-none"
                >
                  Apply fix
                </button>
              )}
            </div>
          )}

          {/* source */}
          <div className="flex-1 overflow-auto">
            <div className="flex min-w-full w-max">
              <div
                aria-hidden
                className="sticky left-0 shrink-0 select-none border-r border-hairline bg-ground px-2 py-2 text-right font-mono text-[12px] leading-[1.7] text-muted"
              >
                {lines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              <div className="px-3 py-2 font-mono text-[12px] leading-[1.7]">
                {lines.map((line, i) => {
                  const changed = fixed && active === CART_PATH && i === CART_BUG_INDEX;
                  return (
                    <div
                      key={i}
                      className={cn('whitespace-pre', changed && 'bg-emerald/10 text-emerald')}
                    >
                      {changed ? line : renderLine(line)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
