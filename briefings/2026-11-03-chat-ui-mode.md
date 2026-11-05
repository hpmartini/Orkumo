# Briefing: Chat-UI als Alternative zum Terminal (Issue #189)

## The Job

Im Agents-Modus (`/agents`) gibt es neben dem Terminal-Pane einen **Chat-Pane**: eine eigene Chat-UI für Claude Code mit gut formatierter Ausgabe (wie Claude Code Desktop) und Markdown-Eingabe. Eine Chat-Session ist ein serverseitig gestarteter `claude`-Prozess im Print-/Stream-JSON-Modus; der Pane zeigt den Verlauf live und nimmt Eingaben entgegen.

Funktionsumfang v1:

- Neue Session in einem Projektverzeichnis starten oder eine **nicht laufende** Session per `--resume <id>` / `--continue` fortsetzen; dieselben Startoptionen wie der Terminal-Launcher (Modell, Permission-Modus inkl. Skip-Permissions).
- Streamende Antwort als gerendertes Markdown (GFM, Codeblöcke, Tabellen); Thinking eingeklappt.
- Tool-Aufrufe als einklappbare Blöcke (Name, Kurzparameter, Ergebnis); Edit/Write als Diff.
- Permission-Anfragen inline mit Erlauben / Ablehnen (/ immer erlauben, falls die CLI es anbietet).
- Stop/Interrupt des laufenden Turns, Session beenden.
- Eingabe: Markdown-Textarea, Bilder per Paste/Drop (vorhandener Upload-Pfad), Slash-Commands werden als Text durchgereicht. Absenden-Taste in den Settings: `Enter` oder `Cmd+Enter`.
- Link „Im Terminal öffnen": beendet den Chat-Prozess und öffnet `claude --resume <session_id>` als normalen Terminal-Tab (Kontext bleibt, VISION-Prinzip 2).

## Why

Säule 3 (Agents) aus [docs/VISION.md](../docs/VISION.md): DevOrbit ist Hapes komplette ADE. Das Terminal ist für lange Agent-Läufe unhandlich: Ausgabe schwer lesbar, Eingabe ohne Formatierung, auf Tablet/Handy (Mesh) kaum bedienbar. Hape will dieselbe Arbeit in einer lesbaren Chat-Oberfläche erledigen, ohne DevOrbit zu verlassen. Später sollen weitere Harnesses (Pi, OMP) dieselbe UI nutzen, daher Trennung zwischen Harness-Ereignissen und Chat-Modell. Kontext: die Chat-Session liest/schreibt Session-ID und cwd; das Transkript landet wie gewohnt in `~/.claude/projects/<slug>/*.jsonl`, damit Peek, Resume-Picker und Kontext-Verknüpfung weiter funktionieren.

## Guardrails

- **Nur die unmodifizierte `claude`-CLI** (VISION-Prinzip 4). Start per Argument-Array, nie per Shell, stdin/stdout-Pipes statt PTY. Kein Zugriff auf Credentials/Keychain. Erlaubt ist `@anthropic-ai/claude-agent-sdk`, wenn es mit `pathToClaudeCodeExecutable` auf die installierte `claude` zeigt und `settingSources` user/project/local lädt (sonst fehlen Hooks, Skills, MCP, Plugins); sonst direkt `claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`. Wahl begründen.
- Server: neuer Service neben `server/services/agentService.js` (z.B. `chatService.js`), Routen unter `/api/agents/chat/*`, Streaming über WebSocket (Muster `/api/pty` in `server/index.js`) oder SSE. Prozess-Cleanup bei Stop, Client-Trennung mit Timeout und Server-Ende; Reconnect zeigt den bisherigen Verlauf.
- Eingaben validieren (cwd existiert und liegt in einem konfigurierten Projektordner, Session-ID-Muster, Modus-Enum), ungültig → 400.
- Pure Logik in `utils/` mit Unit-Tests, Stil wie `utils/agentInput.ts`: `utils/chatEvents.ts` übersetzt CLI-Stream-Events in ein Chat-Nachrichtenmodell. Keine Harness-Abstraktion vorab; ein zweites Harness ist später eine zweite Übersetzer-Datei.
- UI: Pane-Art in `components/AgentsView/AgentWorkspace.tsx` neben `AgentTerminal`/`BrowserPane` (Tabs, Tiling, Drag gelten mit), neue Komponenten unter `components/AgentsView/Chat/`. Eine Shell, kein eigenes Layout. Tailwind + lucide-react wie der Rest.
- Setting `chatSubmitKey: 'enter' | 'mod+enter'` in `agentViewSettingsSchema` (`server/schemas/`) + Settings-Panel, nicht localStorage.
- Nicht anfassen: `--bg`-Agents, `claude attach`, Agent-Liste (`claude agents --json`), Board, Code-Modus, Datenbank-Schema.
- Out of scope: andere Harnesses, MCP-/Plugin-Konfig-UI, eigene Slash-Command-Palette, Datei-Explorer, Mobile-Feinschliff über „bedienbar" hinaus.
- Subagenten: höchstens 3.

## Done means

| ID    | Bedingung                                                                                                                                                                         | Nachweis                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| AC-1  | Lint, Tests und Build laufen grün                                                                                                                                                 | `bun run lint && bun run test:run && bun run build`, Ausgabe im PR              |
| AC-2  | `utils/chatEvents.ts` übersetzt Text-Delta, kompletten Assistant-Turn, tool_use + tool_result, Permission-Anfrage, result/Fehler; kaputte JSON-Zeile wird übersprungen ohne Crash | Unit-Tests je Fall, grün                                                        |
| AC-3  | Start-Parameter werden validiert: cwd außerhalb der Projektordner, Shell-Metazeichen, ungültige Session-ID, unbekannter Modus → 400, kein Prozessstart                            | Unit-/Route-Tests                                                               |
| AC-4  | Neue Chat-Session im Agents-Modus antwortet gestreamt, Markdown (Überschrift, Liste, Codeblock, Tabelle) wird gerendert                                                           | Screenshot im PR (`## Screenshots`)                                             |
| AC-5  | Tool-Aufrufe erscheinen als einklappbare Blöcke, Edit/Write als Diff                                                                                                              | Screenshot                                                                      |
| AC-6  | Im Modus `manual` erscheint eine Permission-Anfrage inline; Erlauben führt das Tool aus, Ablehnen verhindert es                                                                   | GIF des Ablaufs + Dateisystem-Check (Datei existiert / existiert nicht)         |
| AC-7  | Stop bricht einen laufenden Turn ab, die Session nimmt danach neue Eingaben an                                                                                                    | GIF oder Screenshot-Paar                                                        |
| AC-8  | Setting `chatSubmitKey` schaltet zwischen Enter und Cmd+Enter; Shift+Enter/Enter fügt im jeweils anderen Modus Zeilenumbruch ein                                                  | Unit-Test der Tastenlogik + Screenshot Settings                                 |
| AC-9  | Bilder per Paste/Drop landen im Prompt und werden von Claude gesehen                                                                                                              | Screenshot einer Antwort, die das Bild beschreibt                               |
| AC-10 | Nicht laufende Session lässt sich per `--resume` im Chat fortsetzen; „Im Terminal öffnen" beendet den Chat-Prozess und öffnet `claude --resume <id>` mit demselben Verlauf        | Screenshot Terminal-Tab mit Verlauf; Transkript-JSONL-Pfad im PR                |
| AC-11 | Kein verwaister Prozess nach Pane-Schließen, Stop oder Client-Trennung (nach Timeout); Reconnect zeigt bisherigen Verlauf                                                         | `pgrep -fl claude` vorher/nachher im PR; Reload-Screenshot                      |
| AC-12 | Terminal-Panes, Attach und Agent-Liste funktionieren unverändert                                                                                                                  | bestehende Tests grün + Screenshot eines Attach-Terminals neben einem Chat-Pane |

Stopp-Regel: weiterarbeiten, außer die CLI bietet im Print-Modus keinen Weg für Permission-Anfragen; dann `mw board ask`. Rückmeldung: kurzer Bericht mit Dateien, Annahmen und gewählter Anbindung (SDK oder CLI direkt) samt Grund.

## Ambition

- Altitude: Chat-Ansicht auch für laufende `--bg`-Agents (Transkript live + Antwort per Hidden-Attach) würde Terminal im Agents-Modus fast überflüssig machen; nur als Folge-Issue vorschlagen, nicht Scope.
- Depth: Referenz ist Claude Code Desktop bzw. die Agent-SDK-Event-Typen; Rohdaten = echte stream-json-Mitschnitte als Test-Fixtures. Ziel: erstes Token im Pane < 300 ms nach Eintreffen auf dem Server, flüssiges Scrollen bei 500 Nachrichten (virtualisiert, `@tanstack/react-virtual` ist schon da).
- Crew: tut, was ein Sicherheitsprüfer tut (jede Start-Eingabe gegen Pfad-Traversal und Argument-Injection testen, Prozess nie per Shell); tut, was ein A11y-Prüfer tut (Tastaturbedienung Eingabe/Permission-Buttons/Tool-Blöcke, `aria-live` für streamende Antwort); tut, was ein Mobile-Tester tut (Pane auf 390 px Breite bedienbar).

## Prüfung

langlebig · unabhängig · startet lokale Prozesse aus Netzwerk-Eingaben (Vertrauensgrenze) und wird zentrale Arbeitsoberfläche.

## First on approval

Permission-Protokoll im Print-Modus klären: `claude -p … --permission-mode manual` mit einer Write-Aufgabe laufen lassen bzw. die SDK-Quelle lesen, Event-Form festhalten, dann `utils/chatEvents.ts` test-first schreiben.

## Annahmen

- Scope: Chat gilt für eigene Chat-Sessions. Laufende `--bg`-Agents bleiben Terminal/Attach, weil Attach nur PTY kann. Chat-Ansicht für Bg-Agents (Transkript lesen + Antwort per Hidden-Attach) = Folge-Issue. (vorgeschlagen)
- Liste: Print-Sessions erscheinen nicht in `claude agents --json`; der Server führt eine eigene Liste laufender Chat-Sessions, AgentsView zeigt sie als eigene Gruppe „Chat". (vorgeschlagen)
- ToS, geprüft 2026-11-03, code.claude.com/docs/en/legal-and-compliance: Hape meldet sich selbst im unmodifizierten Binary mit seinem Abo an; Print-/SDK-Modus für den eigenen Gebrauch ist „ordinary, individual usage of Claude Code and the Agent SDK". Kein API-Key, kein Token-Zugriff. (vorgeschlagen)
- Spike 2026-11-03, CLI 2.1.317: `-p --input-format stream-json --output-format stream-json --verbose` liefert system/assistant/user(tool_result)/result-Events und endet bei stdin-EOF; dass der Prozess für Mehrfach-Turns offen bleibt, solange stdin offen ist, ist abgeleitet, nicht getestet. Die genaue Form der Permission-Anfrage (`control_request` / `can_use_tool`) war nicht reproduzierbar, weil Hapes Settings Write automatisch erlaubten: an SDK-Quelle oder mit `--permission-mode manual` verifizieren. (vorgeschlagen)
- Dep: Markdown per `react-markdown` + `remark-gfm`; Syntax-Highlighting nur, wenn ein kleines Paket reicht (z.B. `rehype-highlight`), sonst v1 ohne. (vorgeschlagen)
- UI: `ui: on` für das Issue, weil sichtbare UI und neue User Journey (vorgeschlagen)
