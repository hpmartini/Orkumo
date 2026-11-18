# Briefing: Session-Kopien – Tab öffnen hängt an, statt per --resume zu forken (#236)

## The Job
Orkumos Agents-Ansicht (`/agents`) zeigt jeden Agent als genau eine Zeile und hängt Tabs an bestehende Sessions an, statt sie zu kopieren: Hintergrund-Jobs öffnen per `claude attach <id>` und laufen dabei weiter; ein Resume, das unvermeidlich eine neue Session-ID erzeugt, startet erst nach bestätigter Warnung "erzeugt Kopie"; Kopien derselben Quelle erscheinen gruppiert oder als Kopie markiert; jeder Tab zeigt seine Session-ID, und ein zweites Öffnen derselben Session fokussiert den vorhandenen Tab. Problem: Orkumo erzeugt still Zweit-Schreiber im selben Worktree. Vermutete Lösung (zu belegen): der Chat-Default (`agentOpenView: 'chat'`) stoppt Jobs und startet `claude -p --input-format stream-json --resume`.

## Why
Hape lässt viele Agents parallel in Worktrees laufen (MACC-Board). Am 2026-11-06 zeigte Orkumo für `MACC demo-landing#10` drei Zeilen (Job `7305722f` gestoppt, interaktive Kopien `6f6f9c58` und `7305722f`) und ließ nur zwei Tabs zu; zwei Prozesse `claude -p --input-format stream-json --resume <id>` (PIDs 3993, 19245, Eltern: Orkumo Helper) liefen im Worktree `issue-10` auseinander (bis 11-05 18:38 bzw. 23:49) und können sich gegenseitig Arbeit überschreiben; `claude agents` zeigte "Open in a terminal · continue it there". Ziel dahinter: Orkumo ist ein Fenster auf Sessions und erzeugt nie stillschweigend neue – eine Session, ein Worktree, ein Schreiber.

## Guardrails
- Code heute (prüfen, nicht ungeprüft übernehmen): `openAsChat` / `openAgentInChat` / `activateItem` / `openChatInTerminal` in `components/AgentsView/AgentsView.tsx` (~Z. 900–990), `server/services/chatService.js` (`buildChatArgs` mit `--resume`), `resumableSessionId` und Gruppierung (`groupSessions`) in `utils/agentSessions.ts`, Attach-Pane `components/AgentsView/AgentTerminal.tsx`.
- RC (Ursache) zuerst belegen, Fix an der gemeinsamen Stelle statt pro Aufrufer, weil es mehrere Einstiege gibt (Rail-Klick, "Attach in tab", Palette, Board-Sprung, `?attach=`).
- Chat-Pane (#189) bleibt für von Orkumo gestartete Chats und für ausdrücklich gewähltes "Als Chat öffnen" (dann mit Kopie-Warnung).
- Warn-Dialog als In-App-Dialog nach dem Muster in `components/AgentOverview.tsx`, kein `window.confirm`, weil Browser-Dialoge die Electron-/Automations-Sitzung blockieren.
- Nicht anfassen: Mesh/SSH-Attach (`meshHosts`), Cloud-Sessions, Workflow-Provider; uncommittete Änderungen im Haupt-Checkout (CacheBadge, ChatComposer, usage) – Arbeit im eigenen Worktree.
- Tests in `test/` (vitest); Nachweis-Lauf gegen einen Fake-`claude` (Skript auf `PATH` bzw. über `resolveClaudeBinary`), der argv protokolliert, weil echte Jobs Kontingent kosten und nicht deterministisch sind.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Tab öffnen auf einer bestehenden Hintergrund-Session (Rail-Klick mit Default-Einstellung `agentOpenView: 'chat'`, "Attach in tab", `?attach=<id>`) startet `claude attach <id>`, nie `--resume`, und erzeugt keine neue Session-ID | vitest in `test/` über den echten Öffnen-Pfad (Handler aus AgentsView bzw. Server-Route mit Fake-`claude`, der argv loggt): geloggte Kommandos enthalten `attach <id>`, kein `--resume`/`-p`; Menge der Session-IDs vorher = nachher |
| AC-2 | Öffnen eines Hintergrund-Jobs stoppt ihn nicht | derselbe Test: kein Aufruf von `stop`/`/api/agents/:id/stop`; Sichtprüfung: `claude agents --json` zeigt den Job nach dem Öffnen weiter mit unverändertem Status |
| AC-3 | Jeder Pfad, der eine neue Session erzeugen würde (Interaktiv-Session per `--resume` fortsetzen, Job ausdrücklich als Chat öffnen, Chat im Terminal öffnen), zeigt vorher den In-App-Dialog "erzeugt Kopie"; Abbrechen startet keinen Prozess | vitest/RTL: Dialog erscheint, Abbruch → Fake-`claude` nicht aufgerufen; Bestätigen → genau ein Aufruf |
| AC-4 | Zwei oder mehr Sessions derselben Quelle (gleicher Ursprung, z. B. Job + Resume-Kopie im selben Worktree) erscheinen in der Rail als eine Zeile mit sichtbarem Kopie-Hinweis/gruppierten Kopien | Unit-Test in `test/` für die Gruppierung mit Fixture nach dem Muster `7305722f`/`6f6f9c58`; Screenshot der Rail im PR |
| AC-5 | Jeder Tab zeigt die Session-ID, die er hält (Kurz-ID sichtbar oder im Tooltip); zweites Öffnen derselben Session fokussiert den vorhandenen Tab, startet keinen zweiten Prozess | Test: zweimal öffnen → ein Tab, ein Fake-`claude`-Aufruf; Screenshot des Tabs mit ID im PR |
| AC-6 | Unverändert: Dispatch neuer Agents, Start neuer Chats, Mesh-Attach | bestehende Tests grün: `bunx vitest run`, `bunx tsc --noEmit` |
| AC-7 | Endzustand in der laufenden App belegt | `## Screenshots` im PR (Rail mit gruppierter Kopie, Tab mit Session-ID, Kopie-Dialog) und GIF des Ablaufs "Job öffnen → attach"; dazu `ps` nach dem Öffnen ohne neuen `claude -p --resume` |

Stopp-Regel: weiterarbeiten, außer die CLI bietet für einen der Pfade keinen Weg ohne neue Session-ID – dann diesen Pfad hinter AC-3 legen und im PR berichten. Rückmeldung: PR mit RC, Fix, `## Nachweise` je AC, Annahmen.

## Ambition
- Altitude: Orkumo als reiner Viewer, der Sessions nur noch per `attach` öffnet und eigene Chats nur für neue Arbeit startet; würde den Chat-Resume-Pfad ganz überflüssig machen (nur vorschlagen, eigene Freigabe).
- Depth: echte Session-IDs aus `~/.claude/jobs` und `~/.claude/projects/*/*.jsonl` als Ursprungsdaten für die Kopie-Erkennung; Ziel: 0 neue Session-IDs bei jedem Öffnen ohne bestätigte Warnung.
- Crew: tut, was ein Nebenläufigkeits-Prüfer tut: Doppelklick, Re-Mount und zwei Fenster gleichzeitig gegen dieselbe Session durchspielen und zählen, wie viele Prozesse starten.

## Prüfung
langlebig · unabhängig · Kernpfad der Agents-Ansicht, der Prozesse startet und stoppt; Fehler kosten Hape Arbeit in Worktrees.

## First on approval
Reproduzieren: Hintergrund-Job dispatchen, in Orkumo mit Default-Einstellung öffnen, Session-IDs und Prozesse vorher/nachher (`claude agents --json`, `~/.claude/jobs`, `ps`) vergleichen und den forkenden Codepfad belegen.

## Annahmen
- Hintergrund-Jobs öffnen immer per Attach, auch bei `agentOpenView: 'chat'`; Chat nur über explizite Aktion mit Kopie-Warnung. (vorgeschlagen)
- Kopie-Erkennung nutzt vorhandene Daten (Transkript-/`--resume`-Herkunft, Jobs-State, cwd + Name); kein neuer Persistenz-Speicher, solange die Daten reichen. (vorgeschlagen)
- "Lässt nur zwei Tabs zu" ist Folge der Kopien bzw. der Tab-Zuordnung über Session-ID; kein eigenes Tab-Limit-Feature. (vorgeschlagen)
- Bestehende Kopien (z. B. `6f6f9c58`) werden nur markiert, nicht automatisch gestoppt oder gelöscht. (vorgeschlagen)
- `ui: on`, weil sichtbare UI sich ändert (Rail, Tab, Dialog). (vorgeschlagen)
