const CODE_TREE = [
  { name: 'storefront/', active: false },
  { name: '  src/', active: false },
  { name: '    cart.ts', active: false },
  { name: '    checkout.ts', active: true },
  { name: '  package.json', active: false },
];

const CODE_LINES: { text: string; tone: string }[] = [
  { text: 'export async function checkout(cart: Cart) {', tone: 'text-muted' },
  { text: '  const total = cart.items.reduce(sum, 0);', tone: 'text-link' },
  { text: '  return pay(total);', tone: 'text-violet' },
  { text: '}', tone: 'text-muted' },
];

function ViewportIcon({ kind }: { kind: 'monitor' | 'tablet' | 'phone' }) {
  const common = {
    width: 16,
    height: 14,
    viewBox: '0 0 20 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    'aria-hidden': true,
  } as const;
  if (kind === 'monitor') {
    return (
      <svg {...common}>
        <path d="M 2 2 H 18 V 11 H 2 Z" />
        <path d="M 10 11 V 14" />
        <path d="M 7 14 H 13" />
      </svg>
    );
  }
  if (kind === 'tablet') {
    return (
      <svg {...common}>
        <path d="M 5 1 H 15 V 15 H 5 Z" />
        <path d="M 8 12 H 12" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M 7 1 H 13 V 15 H 7 Z" />
      <path d="M 9 12 H 11" />
    </svg>
  );
}

/** the app window: a terminal on the left, editor and browser on the right */
export function WorkspaceIllustration() {
  return (
    <div className="bg-[#101a33]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
        <span className="font-mono text-[12px] text-muted">~/code/storefront</span>
        <span className="label-tape text-muted">Illustration</span>
      </div>

      <div className="grid gap-px bg-hairline lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        {/* terminal */}
        <div className="bg-[#0c152b] p-4">
          <p className="label-tape text-muted">Terminal</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[12px] leading-6 text-muted">
            <div>
              <span className="text-link">$</span> claude attach 4f2a
            </div>
            <div>session 4f2a - needs input</div>
            <div className="text-rose">? Which retry policy should I use?</div>
            <div>1) exponential backoff</div>
            <div>2) fixed delay</div>
            <div>
              <span className="text-link">&gt;</span>{' '}
              <span className="inline-block h-3 w-1.5 translate-y-0.5 bg-link" />
            </div>
          </pre>
        </div>

        <div className="grid gap-px bg-hairline">
          {/* editor */}
          <div className="bg-[#0c152b] p-4">
            <p className="label-tape text-muted">VS Code</p>
            <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <ul className="font-mono text-[12px] leading-6 text-muted">
                {CODE_TREE.map((entry) => (
                  <li key={entry.name} className={entry.active ? 'text-text' : 'text-muted'}>
                    {entry.name}
                  </li>
                ))}
              </ul>
              <pre className="overflow-x-auto font-mono text-[12px] leading-6 text-muted">
                {CODE_LINES.map((line) => (
                  <div key={line.text} className={line.tone}>
                    {line.text}
                  </div>
                ))}
              </pre>
            </div>
          </div>

          {/* browser */}
          <div className="bg-[#0c152b] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="label-tape text-muted">Browser</p>
              <div className="flex items-center gap-2 text-muted" aria-hidden>
                <span className="text-link">
                  <ViewportIcon kind="monitor" />
                </span>
                <ViewportIcon kind="tablet" />
                <ViewportIcon kind="phone" />
              </div>
            </div>
            <div className="mt-3 rounded-[5px] border border-hairline bg-panel p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[12px] text-text">storefront</span>
                <span className="rounded-[3px] bg-blue-strong px-2 py-1 text-[11px] font-semibold text-white">
                  Buy
                </span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="h-8 rounded-[3px] border border-hairline bg-raised" />
                <div className="h-8 rounded-[3px] border border-hairline bg-raised" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
