// Real xterm with the pane's link setup; ?off leaves the styling out (before)
import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { createFileLinkProvider } from '@hpmartini/agents-ui/utils/fileLinks';
import { styleTerminalLinks } from '@hpmartini/agents-ui/utils/terminalLinkStyle';

const terminal = new Terminal({
  cols: 100,
  rows: 14,
  allowProposedApi: true,
  theme: { background: '#0b0f19' },
});
terminal.loadAddon(new WebLinksAddon(() => {}));
terminal.registerLinkProvider(createFileLinkProvider(terminal, () => {}));
terminal.open(document.getElementById('term') as HTMLElement);
if (!document.location.search.includes('off')) styleTerminalLinks(terminal);
(window as unknown as { term: Terminal }).term = terminal;
const lines = [
  '\x1b[1m⏺ PRs offen\x1b[0m',
  '  - #297 https://github.com/hpmartini/Orkumo/pull/297',
  '  - #298 https://github.com/hpmartini/Orkumo/pull/298.',
  '  Geändert: components/AgentsView/AgentTerminal.tsx:198 und utils/terminalLinkStyle.ts',
  '  Log: ~/Library/Logs/Orkumo/main.log, Doku (docs/agents/feature-map.md)',
  '  Lang: https://example.com/' + 'a'.repeat(90) + '/ende',
  '  Kein Link: and/or, http:// allein',
];
(window as unknown as { done: Promise<void> }).done = new Promise((resolve) =>
  terminal.write(lines.join('\r\n') + '\r\n$ ', () => resolve())
);
