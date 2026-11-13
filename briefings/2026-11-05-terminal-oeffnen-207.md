# Briefing: Shell-Terminal im Projektverzeichnis öffnen (#207)

## The Job

Hape öffnet aus Orkumo heraus per Rechtsklick (oder Tastatur-Kontextmenü) auf eine Projektgruppe der Agents-Rail oder auf eine Session ein normales Shell-Terminal ohne Agent, das im Verzeichnis dieses Projekts bzw. dieser Session (Worktree) startet. Er führt dort kurze Befehle aus, ohne ein externes Terminal zu öffnen und hin zu navigieren; das Terminal sitzt als Pane im Agents-Workspace neben den Agent-Terminals und beendet beim Schließen seine Shell.

## Why

Hape arbeitet in Orkumo als kompletter ADE-Umgebung (docs/VISION.md, Modus „Terminal"). Für einen kurzen Befehl (`git status`, `bun test`, `ls`) muss er heute ein externes Terminal öffnen und ins richtige Verzeichnis wechseln. Danach soll Orkumo der Ort sein, an dem auch solche Einzelbefehle laufen, ohne Kontextwechsel.

## Guardrails

- Menü: neuer Eintrag „Open terminal here" in `groupActions` (`components/AgentsView/AgentsView.tsx`, nur wenn `group.cwd` gesetzt, wie „View Code") und in den Session-Zeilen-Aktionen (`rowActions`, cwd der Session). Rechtsklick und Tastatur (ContextMenu/Shift+F10) laufen schon über `AgentList.tsx`; die Menümechanik bleibt, weil sie getestet und barrierefrei ist.
- Pane-Modell: folge dem Browser-Pane-Muster in `utils/agentWorkspace.ts` (`BROWSER_PREFIX`, `browserUrl`, `openBrowser`) mit eigener Pane-ID (z.B. `shell:<n>:<cwd>`), damit Tab-Strip, Drag und Splits sie wie jede Pane behandeln und der Abgleich mit der Session-Liste sie nicht als verwaist entfernt.
- PTY: bestehende Route `/api/pty` ohne `command` (startet die Login-Shell, cwd wird serverseitig validiert, `server/index.js` ~2248). Keine neue Server-Route, keine Lockerung der `ALLOWED_COMMANDS`-Whitelist, weil die PTY-Route eine Sicherheitsgrenze ist.
- Terminal-Rendering: xterm-Setup aus `components/AgentsView/AgentTerminal.tsx` wiederverwenden (Theme, Fit, Links, Cmd-Klick auf Dateien) statt zu duplizieren.
- Out of scope: Code-Modus/Web-IDE (VS Code hat eigenes Terminal), Kontextmenü in `ProjectsRail.tsx` (hat keins), Command-Palette-Eintrag, Wiederanhängen laufender Shells nach Reload.

## Done means

| ID   | Bedingung                                                                                                                                                             | Nachweis                                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Rechtsklick auf eine Projektgruppe mit cwd zeigt „Open terminal here"; Auswahl öffnet eine Shell-Pane, in der `pwd` exakt dieses Verzeichnis ausgibt                  | E2E-Skript `scripts/review/207-e2e.cjs` (Playwright gegen laufenden Dev-Server, echter Rechtsklick, tippt `pwd`, vergleicht xterm-Ausgabe) |
| AC-2 | Gleiches für eine Session-Zeile: Shell startet im cwd der Session (Worktree), nicht im Projektstamm                                                                   | `207-e2e.cjs`, Fall Session mit eigenem Worktree-cwd                                                                                       |
| AC-3 | Menüeintrag ist per Tastatur erreichbar (ContextMenu bzw. Shift+F10 auf ausgewählter Zeile) und fehlt bei Gruppen ohne cwd und in der Favoriten-Sektion               | Vitest in `test/` (AgentList/AgentsView, Stil `test/railModes.test.tsx`)                                                                   |
| AC-4 | Schließen der Pane beendet den PTY-Prozess; kein Shell-Prozess bleibt übrig                                                                                           | `207-e2e.cjs`: PID der Shell vor dem Schließen lesen (`echo $$`), danach `kill -0 <pid>` schlägt fehl                                      |
| AC-5 | Shell-Pane-IDs: Parser, Öffnen-Funktion und Abgleich mit der Session-Liste (`pruneMissing`) behalten Shell-Panes; mehrere Shells pro Verzeichnis haben eindeutige IDs | Unit-Tests in `utils/agentWorkspace.test.ts`                                                                                               |
| AC-6 | Agent-, Chat- und Browser-Panes unverändert; Typecheck und alle Tests grün                                                                                            | `bunx tsc --noEmit` und `bunx vitest run` grün, Ausgabe im PR                                                                              |
| AC-7 | Endzustand sichtbar belegt: Kontextmenü mit Eintrag und offene Shell-Pane mit `pwd`-Ausgabe                                                                           | Screenshots im PR unter `## Screenshots` plus GIF des Ablaufs Rechtsklick → Terminal → Befehl                                              |

## Ambition

- Altitude: ein eigener Modus „Terminal" in der Mode-Bar (VISION nennt ihn) könnte Shells pro Kontext bündeln; nur Vorschlag, eigene Freigabe nötig.
- Depth: Ziel wie ein natives Terminal: Pane ist in < 1 s nach Klick eingabebereit, Login-Shell mit Hapes Profil (PATH, Prompt), Größe passt sich an Splits an.
- Crew: tut, was ein Sicherheitsprüfer tut: belegt, dass die Funktion nur den bestehenden cwd-validierten `/api/pty`-Pfad nutzt und kein neuer Weg Befehle oder Pfade aus der URL ungeprüft an eine Shell gibt.

## Prüfung

langlebig · unabhängig · Kernfunktion der dauerhaft genutzten ADE und berührt die PTY-Grenze (Shell-Zugriff übers Netz, auch Remote-Pairing).

## First on approval

`utils/agentWorkspace.ts` lesen und die Shell-Pane-ID (Präfix, Parser, Öffnen-Funktion) analog zu `openBrowser` test-first anlegen.

## Annahmen

- Pane öffnet in einem neuen, fokussierten Tab, nicht als Split in den aktiven Tab (vorgeschlagen)
- Nach Reload bleibt die Pane (ID persistiert wie Browser-Panes) und startet eine frische Shell im selben cwd; alter Shell-Zustand geht verloren (vorgeschlagen)
- Tab-Titel = Verzeichnisname mit Terminal-Icon; mehrere Shells pro Verzeichnis erlaubt (vorgeschlagen)
- Shell = die von `detectShell()` in `server/services/ptyService.js` gewählte Shell, wie die PTY-Route sie ohne `command` startet (vorgeschlagen)
- `ui: on`, da sichtbare UI und neue User Journey (vorgeschlagen)
