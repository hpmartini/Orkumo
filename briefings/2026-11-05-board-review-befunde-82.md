# Briefing: Review-Befunde aus #82 abarbeiten (Issue #88)

## The Job

Issues auf dem Board in jedem Repo korrekt anlegen und bearbeiten, auch wenn es mehr als 100 Labels, mehr als 100 zuweisbare User, mehr als 50 offene Milestones oder ein Issue mehr als 50 Sub-Issues hat; ein Issue bei kaltem Board-Cache anlegen, ohne vorher alle Board-Items zu laden; Schreibzugriffe auf Repos außerhalb einer Erlaubnisliste abweisen; die `gh`-Argumentübergabe und die Update-Mutation so absichern, dass ein späterer Umbau keinen Dateizugriff (`-F @pfad`) und keine falschen GraphQL-Typen einschleust; die fehlenden Tests nachziehen, den flaky Test `test/railPreferences.test.tsx` an der Ursache stabilisieren und das alte Briefing ans Gelieferte angleichen. Betroffen: `server/services/boardService.js` (`REPO_OPTIONS_QUERY`, `ISSUE_DETAILS_QUERY`, `createIssue`, `ghGraphql`/`splitVars`, `applyIssuePatch`), die Board-Schreibrouten in `server/index.js` (`/api/board/issues*`, `/api/board/items/:itemId/issue`, `/api/board/images`), `test/`, `briefings/2026-10-23-issues-anlegen-bearbeiten.md`.

## Why

Hape nutzt das Board in Orkumo als Kommandozentrale (MACC) für alle Repos, inzwischen auch remote (Tailscale, `remoteAccess`). Damit wird „jedes Repo des gh-Tokens darf beschrieben werden" zum echten Risiko, und große Repos (>100 Labels → „Unknown label", 400) oder ein kalter Cache (~10 s bei MACC, Timeout 30 s je Seite) machen Anlegen unzuverlässig. Ziel: Issue-Schreiben ist korrekt, schnell und sicher genug für den Remote-Betrieb, ohne dass Hape Befunde aus #82 weiter nachhalten muss.

## Guardrails

- Bestehende Muster weiterverwenden: `ghGraphql` (execFile, keine Shell), `httpError`/`detailedError`, TTL-Caches wie `getRepoOptions`, Cursor-Paginierung wie die Kommentar-Abfrage (`comments(first:100,after:$after)`), Zod-Schemas in `server/schemas/`, Tests mit gemocktem `execFile` wie `test/boardService.test.js`/`test/boardWrites.test.js`. Grund: ein Stil, ein Testaufbau.
- Antwortformate zum Frontend (`services/api.ts`, `components/BoardView/*`) bleiben gleich; neu ist nur 403 für nicht erlaubte Repos. Grund: UI ungeändert lassen.
- Prettier nur auf geänderte Zeilen; reine Format-Änderungen, falls nötig, in eigenem Commit. Grund: genau dieser Befund aus #82.
- Out of scope: Issue-Type, weitere Project-Felder, Markdown-Vorschau bauen; Board-UI umbauen.

## Done means

| ID    | Bedingung                                                                                                                                                                                                                       | Nachweis                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ------------------ |
| AC-1  | Label auf Position 101+ (Repo mit >100 Labels), Assignee auf Position 101+ und offener Milestone auf Position 51+ werden von `resolveIssueRefs` aufgelöst; kein „Unknown label/assignee/milestone" (400) für existierende Namen | Test über `POST /api/board/issues` (Route, gemocktes `gh` mit mehrseitigen Antworten inkl. `pageInfo`), Mock prüft, dass Folgeseiten mit `after`-Cursor abgefragt werden                    |
| AC-2  | `getIssueDetails` liefert alle Sub-Issues, auch mehr als 50                                                                                                                                                                     | Test mit Mock: 2 Seiten Sub-Issues, Ergebnis enthält alle                                                                                                                                   |
| AC-3  | Paginierung endet sicher: bei `hasNextPage` ohne Ende bricht sie nach einer festen Seitenobergrenze mit Fehler ab statt endlos zu laufen                                                                                        | Test mit Mock, der immer `hasNextPage:true` liefert                                                                                                                                         |
| AC-4  | `createIssue` bei kaltem Cache führt `ITEMS_QUERY` (alle Board-Items) nicht aus; `projectId` und Status-Feld kommen aus einer eigenen, gecachten Metadaten-Abfrage                                                              | Test: Mock zählt Aufrufe je Query, `ITEMS_QUERY` = 0; Messung gegen MACC über das laufende Orkumo: `POST /api/board/issues` nach Server-Neustart antwortet schneller als ~10 s (Zeit im PR) |
| AC-5  | `ghGraphql`/`splitVars` dokumentieren, dass `-F` nur für Zahlen und `null` gilt (wegen `-F k=@pfad`); ein String-Wert landet nie hinter `-F`, auch einer, der mit `@` beginnt                                                   | Kommentar im Diff; Test: Titel `@/etc/passwd` → Argument steht hinter `-f`                                                                                                                  |
| AC-6  | `applyIssuePatch` bestimmt GraphQL-Typen aus fester Typ-Map oder fester Mutation, nicht aus `endsWith('Ids')`; unbekannter Feld-Key → Fehler                                                                                    | Code im Diff; Test: unbekannter Key wirft, bekannte Keys erzeugen `[ID!]`/`ID`/`String` korrekt                                                                                             |
| AC-7  | Alle Board-Schreibrouten lehnen Repos außerhalb der Erlaubnisliste mit 403 ab, lokal wie remote                                                                                                                                 | Route-Tests je Schreibroute (403 fremdes Repo, 2xx erlaubtes Repo); echter Pfad: curl gegen laufendes Orkumo mit fremdem Repo → 403 (Ausgabe im PR)                                         |
| AC-8  | Routen validieren: unbekannte Keys im Body → 400, ungültige `issueId` → 400; `getRepoOptions` hält TTL (5 min) und umgeht sie mit `refresh`                                                                                     | Route-/Service-Tests mit Fake-Timern                                                                                                                                                        |
| AC-9  | Ursache des flaky `test/railPreferences.test.tsx` (localStorage undefined unter Node 26) belegt und behoben, ohne Retry                                                                                                         | Ursache im PR-Text; `for i in $(seq 20); do bunx vitest run test/railPreferences.test.tsx                                                                                                   |     | exit 1; done` grün |
| AC-10 | `briefings/2026-10-23-issues-anlegen-bearbeiten.md` markiert Markdown-Vorschau, Issue-Type und weitere Project-Felder als „nicht in #82 geliefert, Folgearbeit"                                                                 | Diff der Datei                                                                                                                                                                              |
| AC-11 | Bestehendes bleibt grün, Typen sauber                                                                                                                                                                                           | `bunx tsc --noEmit` und `bunx vitest run` grün (Ausgabe im PR)                                                                                                                              |
| AC-12 | Anlegen und Bearbeiten funktionieren end-to-end in einem erlaubten Repo                                                                                                                                                         | Über das laufende Orkumo per API ein Test-Issue (Titel mit „[test #88]") anlegen, Label/Titel ändern, per `gh issue view` prüfen, danach schließen (Links im PR)                            |

Weiterarbeiten außer bei: GitHub-API weicht ab (z. B. kein `pageInfo` an einem Feld) oder die Erlaubnisliste bricht einen bestehenden Workflow; dann berichten. Rückmeldung: PR mit `## Nachweise` je AC, Annahmen genannt.

## Ambition

- Altitude: keine; Sammelissue mit festem Umfang.
- Depth: echte GitHub-Grenzen (`pageInfo`, `first:100` max) statt Annahmen; Zeitmessung Kaltstart gegen MACC; Ziel Anlegen bei kaltem Cache < 2 s.
- Crew: tut, was ein Sicherheitsprüfer tut: jede Schreibroute mit fremdem Repo, mit `@`-Strings und unbekannten Keys angreifen; tut, was ein Testingenieur tut: Flaky-Ursache reproduzieren (Node-26-Web-Storage vs. jsdom) statt maskieren.

## Prüfung

langlebig · unabhängig · Schreibrouten sind eine Vertrauensgrenze (Remote-Zugriff, Eingaben aus dem Netz, Token mit Schreibrechten).

## First on approval

Worktree vom Remote-Stand anlegen und in `boardService.js` die Cursor-Paginierung für `REPO_OPTIONS_QUERY` samt Test für ein Label auf Seite 2 bauen (AC-1).

## Annahmen

- Erlaubte Repos = Repos, die als Items auf dem Board-Project vorkommen, plus origin-Repos der lokal registrierten Projekte; gilt immer, nicht nur remote. Bietet der Repo-Picker im Anlegen-Dialog andere Repos an, kommt er auf dieselbe Liste. (vorgeschlagen)
- Seitenobergrenze der Paginierung 20 Seiten je Feld (= 2000 Labels). (vorgeschlagen)
- Flaky-Ursache vermutlich Node 26 (globales Web-Storage-`localStorage`) gegen jsdom; Fix im Test-Setup oder `vitest.config.ts`. (vorgeschlagen)
- Doku-Punkt per Angleichen des alten Briefings, kein neues Folge-Issue. (vorgeschlagen)
- Format-Hygiene ist Arbeitsregel für diesen PR, kein eigenes Tooling (kein Pre-Commit-Hook). (vorgeschlagen)
- `ui: off`: keine sichtbare UI-Änderung, keine Screenshots. (vorgeschlagen)
