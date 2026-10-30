# Briefing: Agent-Terminal — Shift+Enter und Symbole wie in Ghostty (DevHub#74)

## The Job

In den xterm-Terminals von DevOrbit (vor allem `components/AgentsView/AgentTerminal.tsx`, ebenso `components/XTerminal.tsx` für Detailansicht/CodingView) verhält sich eine laufende Claude-Code-Session wie in Ghostty:

- **Shift+Enter fügt im Claude-Code-Prompt eine neue Zeile ein** und schickt den Prompt nicht ab. Enter schickt weiterhin ab.
- **Die Statuszeile rendert vollständig:** Nerd-Font-Icons (Powerline-Pfeile, Git-Branch, Ordner, Uhr usw.) und Emoji (⚡, 💡) erscheinen als Glyphen statt als Kästchen, mit korrekter Zellbreite, sodass die Segmente nicht verrutschen. Referenz im Issue: „Ziel“-Screenshot (Ghostty) vs. „Aktuell“-Screenshot (DevOrbit, Kästchen statt Icons).
- Das funktioniert im Electron-Build und im Browser, auch auf einem Gerät ohne lokal installierten Nerd Font.

## Why

DevOrbit wird Hapes komplette Arbeitsumgebung für agentische Entwicklung (`docs/VISION.md`); im Agent-Terminal schreibt er Prompts an Claude Code. Ohne mehrzeilige Eingabe und mit kaputter Statuszeile (Kosten, Limits, Branch, Buttons) greift er wieder zu Ghostty. Ziel: Terminal in DevOrbit ist gleichwertig, Ghostty wird unnötig.

## Guardrails

- Root cause vor Fix, mit Beleg. Befunde aus dem Code, unbestätigt: Shift+Enter sendet heute `\x1b[13;2u` (CSI u) an drei Stellen (`AgentTerminal.tsx` ~143, `XTerminal.tsx` ~358 und ~576 im Reconnect-Pfad). Mögliche Ursachen: Claude Code wertet CSI u nur nach Aktivierung des Kitty-Keyboard-Protokolls aus (xterm.js unterstützt es nicht), oder das folgende `keypress` erzeugt trotz `return false` zusätzlich `\r`. Was Claude Code in Terminals ohne Kitty-Protokoll als Newline akzeptiert (z. B. `ESC CR`, wie Option+Enter), in der Claude-Code-Doku zu `/terminal-setup` nachlesen und die Sequenz danach wählen.
- Annahme: Die Shift+Enter-Sequenz wird für alle Terminals gleich gesendet; normale Shells bekommen dadurch kein Fehlverhalten (prüfen in zsh).
- Font: Default-`fontFamily` in `hooks/useGhosttyTheme.ts` bekommt einen Symbol-Fallback. Annahme: „Symbols Nerd Font Mono“ (MIT/OFL) wird als woff2 unter `public/fonts/` mitgeliefert und per `@font-face` geladen, statt auf lokal installierte Fonts (Hape hat Hack Nerd Font) zu setzen; das deckt Browser auf fremden Geräten ab. Font muss geladen sein, bevor xterm misst (`document.fonts.load`), sonst stimmen Zellbreiten nicht.
- Emoji/Breiten: `@xterm/addon-unicode11` (offizielles xterm-Addon, einzig erlaubte neue Dependency) nur, wenn sich Breitenfehler belegen lassen.
- Shortcut-Logik einmal ablegen (z. B. `utils/terminalKeys.ts`, rein und unit-getestet) und an allen `attachCustomKeyEventHandler`-Stellen nutzen. Das deckt sich mit Briefing `briefings/2026-10-23-terminal-eingabe-shortcuts.md` (#65, noch nicht umgesetzt): gleichen Dateinamen verwenden, #65-Shortcuts (Option/Cmd+Backspace, Cmd+W, Eingabeverlust) nicht mit umsetzen.
- Bestehendes bleibt: F6 → Rail-Fokus, Ghostty-Theme/-Font hat Vorrang, Cmd+C/V.
- Nicht anfassen: Mesh/Remote (#57), Board (#44), Tab-Layout. Höchstens 1 Subagent.

## Done means

- Unit-Test für die Key-Mapping-Funktion (Shift+Enter → gewählte Sequenz, Enter und normale Tasten unverändert).
- `bun run lint`, `bun run test`, `bun run build` grün.
- Beleg in der laufenden App (Playwright-Screenshot): Agent-Terminal mit Claude Code, Shift+Enter erzeugt zweite Prompt-Zeile, Enter schickt ab; Statuszeile zeigt Icons ohne Kästchen, verglichen mit dem Ziel-Screenshot.
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/74` und `## Review-Anleitung`.
- Rückmeldung: Bullets mit Root Cause je Problem, Fix, Dateien, Annahmen. Weiterarbeiten, außer Claude Code akzeptiert über xterm.js keine Newline-Sequenz; dann mit Beleg nachfragen.

## First on approval

Root cause Shift+Enter belegen: App starten (`bun run dev`), Agent-Terminal mit `claude` öffnen, Shift+Enter drücken und die gesendeten Bytes im WebSocket-Frame bzw. im PTY mitschneiden.
