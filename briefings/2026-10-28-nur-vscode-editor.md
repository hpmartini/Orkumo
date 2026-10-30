# Briefing: Nur noch VS Code als integrierter Editor (Monaco ausbauen)

Issue: https://github.com/hpmartini/DevHub/issues/139

## The Job

Im Web-IDE-Panel (Coding-Sub-View im Details-View und Modus „Code“) öffnet sich immer direkt VS Code (code-server). Der Umschalter „Monaco | VS Code“ oben im Panel verschwindet, ebenso der Monaco-Editor mit eigenem Dateibaum, alle Hinweise „use the Monaco editor“ in Fehlermeldungen und der Code, der nur für Monaco existiert. Fehlerzustände von code-server (nicht installiert, Start fehlgeschlagen, Timeout) bieten weiter „Retry“ und Installationshinweise, nur ohne Monaco-Ausweg.

## Why

Hape arbeitet in DevOrbit als ADE (siehe docs/VISION.md) und will einen einzigen, vollwertigen Editor statt zwei halber. Weniger Code im Panel heißt weniger Pflege; später kommt evtl. Neovim als zweite Option, das ist aber nicht Teil dieses Auftrags.

## Guardrails

- Betroffene Stellen (Stand origin/main eb2c0ae): `components/CodingView/WebIDEPanel.tsx` (Toggle Z. ~863–890, Monaco-Zweig ab ~924, Dateibaum/Open-Files-State, Fehlertexte), `components/CodingView/index.tsx`, `components/AppDetail.tsx` (Props `editorType`/`onEditorTypeChange`), `hooks/usePerAppState.ts`, `types.ts` (`EditorType`, Feld `editorType`), `components/CodeView/index.tsx` (nutzt `WebIDEPanel`), `test/WebIDEPanel.test.tsx`, `package.json`/`bun.lock` (`@monaco-editor/react`), `server/index.js` (`/api/files/tree|read|write` + Sprach-Mapping, Z. ~1424–1600), README und docs, die Monaco als Option beschreiben.
- code-server-Koordination (Shared Manager, Warm-up, Restart-Throttle, Docker- vs. lokaler Pfad) bleibt unverändert, weil sie hart erarbeitete Race-Fixes enthält.
- Gespeicherter Per-App-State mit `editorType: 'monaco'` darf nichts brechen: wird ignoriert, Panel zeigt VS Code.
- Kein neuer Abstraktions-Layer „für Neovim später“; das kommt, wenn es gebraucht wird.
- `bun.lock` ist im Haupt-Checkout uncommittet geändert; Arbeit im eigenen Worktree von origin/main.

## Done means

| ID   | Bedingung                                                                                                                             | Nachweis                                                                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- | ------------- |
| AC-1 | Web-IDE-Panel rendert ohne Umschalter „Monaco/VS Code“ und zeigt direkt das code-server-iframe (Details-View-Coding und Modus „Code“) | Vitest in `test/WebIDEPanel.test.tsx`: kein Button „Monaco“, iframe vorhanden; plus Screenshot des laufenden Dev-Servers                                          |
| AC-2 | Kein Monaco mehr im Code: Dependency entfernt, kein Import, keine Texte „Monaco“ in UI/Fehlermeldungen                                | `git grep -niE "monaco" -- ':!CHANGELOG.md' ':!briefings' ':!hooks/useGhosttyTheme.ts'` liefert nichts (Font-Name „Monaco“ im Terminal-Font-Stack bleibt erlaubt) |
| AC-3 | Fehlerzustände von code-server zeigen Retry und Installationshinweis, ohne Monaco-Verweis                                             | Vitest: Status `not installed` → Text mit `brew install code-server`, Button „Retry“, kein Monaco-Button                                                          |
| AC-4 | Alter Per-App-State mit `editorType: 'monaco'` lädt ohne Fehler, Panel zeigt VS Code                                                  | Vitest mit vorbelegtem State/localStorage                                                                                                                         |
| AC-5 | Monaco-only-Endpunkte `/api/files/tree                                                                                                | read                                                                                                                                                              | write` sind entfernt (keine Datei-Lese/Schreib-API mehr, die nur Monaco brauchte) | `curl -s -o /dev/null -w '%{http_code}' localhost:<port>/api/files/tree?path=/` → 404; `git grep "files/(tree | read | write)"` leer |
| AC-6 | Build, Typecheck und Testsuite grün                                                                                                   | `bun run build`, `bunx tsc --noEmit`, `bun run test` Ausgabe im PR                                                                                                |

Stopp-Regel: weiterarbeiten, außer ein anderer Konsument der `/api/files`-Endpunkte taucht auf (dann AC-5 als offen mit Grund melden und Endpunkte behalten).

## Ambition

- Altitude: keine; Auftrag ist klar abgegrenzt.
- Depth: Bundle-Größe vorher/nachher aus `bun run build` notieren (Monaco-Chunk weg).
- Crew: tut, was ein Sicherheitsprüfer tut: bestätigt, dass mit den Endpunkten auch Rate-Limiter/Pfad-Validierung nur für diese entfernt wird und keine andere Route sie mitnutzt.

## Prüfung

langlebig · unabhängig · tägliche Arbeitsumgebung, und der Diff entfernt eine Datei-Lese/Schreib-API an einer Vertrauensgrenze.

## First on approval

Worktree von origin/main anlegen und `test/WebIDEPanel.test.tsx` auf das Zielverhalten (kein Toggle, nur iframe) umschreiben.

## Annahmen

- Monaco wird komplett entfernt, nicht nur versteckt (vorgeschlagen).
- `/api/files/*` hat außer Monaco keinen Konsumenten (Stand origin/main geprüft) und wird mit entfernt (vorgeschlagen).
- `EditorType`-Typ und Prop `editorType` fallen weg statt auf `'code-server'` eingeengt zu werden (vorgeschlagen).
- Neovim bleibt Out-of-scope; eigenes Issue bei Bedarf (vorgeschlagen).
- CHANGELOG bekommt einen Eintrag „Monaco entfernt“; alte Einträge bleiben (vorgeschlagen).
