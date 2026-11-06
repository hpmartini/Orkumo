# Briefing: Integration anderer Harnesses (Issue #195)

## The Job

Im Agents-Modus (`/agents`) kann Hape einen neuen Agent nicht nur mit Claude Code, sondern auch mit **Oh My Pi** (`omp`), **OpenCode** (`opencode`), **Codex** (`codex`) und **Pi** (`pi`) starten. Ein **Default-Harness** steht in den Agent-Settings; beim Anlegen eines Agents (Dispatch-Eingabe und Task-Composer) wählt Hape pro Agent den Harness, vorbelegt mit dem Default. Jede Agent Card zeigt, mit welchem Harness der Agent läuft (auch bei Claude), als kleines Badge mit Name/Icon, positionierbar wie die übrigen Card-Felder.

Ein Nicht-Claude-Agent läuft v1 als **interaktiver Prozess im vorhandenen Terminal-Pane** (PTY) im gewählten Projektordner; ein mitgegebener Prompt wird als erste Nachricht übergeben, wo die CLI das interaktiv kann. Claude bleibt unverändert (`--bg`-Dispatch, Chat, Attach). Ist ein Harness-Binary nicht installiert, zeigt die Auswahl das an und der Start bricht mit klarer Meldung ab statt mit einem toten Terminal.

## Why

Säule 3 (Agents) aus [docs/VISION.md](../docs/VISION.md): Orkumo ist Hapes komplette ADE, und Hape arbeitet nicht nur mit Claude Code. Codex-Konten laufen schon in `/usage`; Pi/OMP sind in `utils/chatEvents.ts` als nächste Harnesses vorgesehen. Ziel hinter dem Ziel: jede Aufgabe mit dem passenden Harness/Kontingent starten, ohne Orkumo zu verlassen, und im Board/Agent-Überblick sehen, wer was mit welchem Werkzeug macht. Dieses Issue ist der erste Schritt („als erstes integrieren wir …“); Chat-UI, Usage und Hintergrundbetrieb für die neuen Harnesses folgen später.

## Guardrails

- Annahme: Integrationsweg ist der PTY-Pane, nicht der Chat-Pane. Grund: funktioniert für alle vier gleich; ein Chat-Reducer je Harness (`pi --mode rpc`, `omp --mode rpc`, `codex app-server`, `opencode serve`) ist je Harness eigene Arbeit und Folge-Issue.
- **Vertrauensgrenze:** Heute darf nur `claude` gestartet werden (`config/defaults.ts:78` / `config/defaults.js:81` `allowedCommands`, `pty-host/execPolicy.js` `isAllowedExec`, `/api/pty` in `server/index.js` ~2290-2360 mit Claude-spezifischen Prüfungen). Erweitern nur um genau die vier Binaries, je Harness eine feste Liste erlaubter Flags; der Prompt ist genau ein positionales Argument (nach `--`, wo die CLI das kennt). Start immer per Argument-Array, nie per Shell. Binary-Auflösung analog `resolveClaudeBinary` (PATH, `/opt/homebrew/bin`, `~/.local/bin`), kein freier Pfad aus dem Client. cwd muss in einem konfigurierten Projektordner liegen (`assertAllowedPath`).
- Datenmodell: `types.ts` `AgentSession.ptyCommand` ist `'claude' | 'ssh'`; `utils/agentSessions.ts:1022` verzweigt darauf. Harness als eigenes Feld oder erweiterter `ptyCommand`, die Session wählt; Claude-Sessions aus `claude agents --json` und Chats bekommen `claude`.
- Settings: Default-Harness in `agentViewSettingsSchema` (`server/schemas/agentViewSettings.js`, strict), Enum `claude | omp | opencode | codex | pi`, Default `claude`; UI in `AgentSettingsPanel`. Card-Feld `harness` in `cardFields` aufnehmen, Default-Position so, dass es ohne Einstellung sichtbar ist.
- Launcher: `openInteractiveClaude` in `components/AgentsView/AgentsView.tsx` verallgemeinern statt duplizieren. Picker in `DispatchInput` und `TaskComposerModal`; Claude-spezifische Optionen (Modell, Effort, Permission-Modus, Skip-Permissions) ausblenden oder deaktivieren, wenn ein anderer Harness gewählt ist.
- Annahme: Nicht-Claude-Agents haben denselben Lebenszyklus wie heutige interaktive Claude-PTYs (Eintrag in `cloudSessions`, React-State); nach Reload ist die Card weg. Persistenz über Reload ist Folge-Issue.
- Annahme: Keine Harness-Optionen (Modell, Provider, Resume) in v1, Start ohne Zusatzflags außer Prompt. Auth/Login macht Hape in der jeweiligen CLI selbst.
- Annahme: „Open Code“ meint das CLI `opencode`. Installiert ist `/opt/homebrew/bin/opencode` 0.0.55 (archivierte Go-Version, Tap überschattet `homebrew/core/opencode`, das ist sst/opencode). Interaktiv starten geht mit beiden; die Prompt-Übergabe nur, wo die installierte Version einen interaktiven Prompt-Parameter hat (sst: `--prompt`), sonst Start ohne Prompt mit Hinweis.
- Nicht anfassen: `--bg`-Dispatch, `claude attach`, Chat-Pane (#189), Board, `/usage`, Datenbank-Schema, Remote-/Cloud-Sessions.
- Out of scope: Chat-UI für andere Harnesses, Usage/Limits für Pi/OMP/OpenCode, Hintergrund-Dispatch (z.B. `codex agents`), Resume-Picker je Harness, Installation fehlender CLIs.
- Subagenten: höchstens 3.

## Done means

| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Lint, Typecheck, Tests und Build grün | `bun run lint && bunx tsc --noEmit && bun run test:run && bun run build`, Ausgabe im PR |
| AC-2 | Settings: `dispatch.harness` (bzw. gewählter Schlüssel) akzeptiert genau `claude, omp, opencode, codex, pi`; anderer Wert → 400 über `PUT /api/settings/agent-view`; gesetzter Wert überlebt Server-Neustart | Route-Test mit echtem Settings-Speicher + `curl` vor/nach Neustart im PR |
| AC-3 | `/api/pty` und `pty-host` starten jeden der vier Harnesses mit erlaubten Argumenten; nicht gelistetes Binary, nicht gelistetes Flag, cwd außerhalb der Projektordner → abgelehnt, kein Prozess | Unit-Tests für Policy/Validierung + WebSocket-Test gegen `/api/pty` mit je einem abgelehnten Fall; `pgrep` danach leer |
| AC-4 | Dispatch mit Harness X (je einmal für omp, opencode, codex, pi) startet im gewählten Projektordner den Prozess X im Terminal-Pane; ein Prompt kommt als erste Nachricht an (opencode: siehe Annahme) | `pgrep -fl 'omp|opencode|codex|pi'` + `lsof -p <pid> \| grep cwd` je Harness im PR; Screenshot je Harness |
| AC-5 | Picker in Dispatch-Eingabe und Task-Composer ist mit dem Default-Harness vorbelegt; Ändern des Defaults in den Settings ändert die Vorbelegung; Claude-only-Optionen sind bei anderem Harness aus | Komponententest + Screenshot Settings und Picker |
| AC-6 | Jede Agent Card zeigt ihren Harness (Claude-bg, Chat, interaktiv, omp, opencode, codex, pi); das Feld ist über `cardFields` positionierbar/ausblendbar | Unit-Test der Ableitung Session → Harness + Screenshot Liste mit mindestens drei verschiedenen Harnesses |
| AC-7 | Fehlt ein Binary, ist es im Picker als nicht installiert markiert und ein Start liefert eine klare Fehlermeldung, kein leeres Terminal | Test mit leerem PATH für ein Binary + Screenshot der Meldung |
| AC-8 | Claude-Dispatch (`--bg`), Attach, Chat-Pane und Agent-Liste funktionieren unverändert | bestehende Tests grün + Screenshot eines Claude-bg-Agents neben einem Codex-Agent |
| AC-9 | Nach Schließen des Panes oder Stop eines Harness-Agents läuft kein verwaister Prozess | `pgrep -fl` vorher/nachher im PR |

Stopp-Regel: weiterarbeiten, außer ein Harness lässt sich nicht ohne Shell oder ohne freie Argumente starten; dann `mw board ask`. Rückmeldung: kurzer Bericht mit Dateien, Annahmen, Flag-Allowlist je Harness.

## Ambition

- Altitude: Ein gemeinsamer Chat-Pane für alle Harnesses (RPC-/JSON-Modi von pi/omp/codex/opencode → `ChatState`) plus Usage je Harness würde das Terminal im Agents-Modus ersetzen; nur als Folge-Issue vorschlagen.
- Depth: `--help` jeder installierten CLI ist die Quelle für Flags und Prompt-Übergabe; Versionen im PR notieren (`codex-cli 0.160.0`, `omp 18.16.0`, `pi 0.99.1`, `opencode 0.0.55`). Start bis erste TUI-Ausgabe < 2 s wie bei Claude.
- Crew: tut, was ein Sicherheitsprüfer tut (jede Start-Eingabe gegen Binary-Tausch, Flag-Injection wie `--config`/`--api-key`/`-c`, Pfad-Traversal im cwd testen); tut, was ein UX-Prüfer tut (Badge auch in kompakter Card-Dichte lesbar, Harness per Tastatur wählbar).

## Prüfung

langlebig · unabhängig · erweitert, welche Binaries aus Netzwerk-Eingaben gestartet werden (Vertrauensgrenze).

## First on approval

`pty-host/execPolicy.js`, `config/defaults.ts` und den `/api/pty`-Handler in `server/index.js` lesen und die Flag-Allowlist je Harness aus deren `--help` festlegen.

## Annahmen

- PTY-Pane statt Chat-Pane für v1 (vorgeschlagen)
- Nicht-Claude-Agents überleben keinen Reload, wie interaktive Claude-PTYs heute (vorgeschlagen)
- Keine Harness-Optionen (Modell/Provider/Resume) in v1 (vorgeschlagen)
- OpenCode = installiertes `opencode`; Prompt-Übergabe nur, wenn die Version es interaktiv kann (vorgeschlagen)
- Harness-Badge auch bei Claude-Agents (vorgeschlagen)
- `ui: on` für Screenshots im PR (vorgeschlagen)
