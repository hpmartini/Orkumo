# Briefing: PR-View neben Board (#191)

## The Job

Hape mit einem Klick aus der Titelleiste in einen eigenen PR-Arbeitsmodus bringen und ihn dort alle offenen PRs durchgehen lassen: eingrenzen, gruppieren und ordnen, bis er sieht, was merge-bereit ist, was an CI oder Review hängt und welcher Agent dazugehört. Konkret: ein vierter Modus-Button „Pull Requests" (Icon `GitPullRequest`) neben Workflows, Board und Code, der `/pulls` öffnet und beim zweiten Klick wie die anderen zu `/agents` zurückführt. `/pulls` bekommt eine Bedienleiste über der Liste:

- **Filter** (kombinierbar, UND): Freitext (Titel, Nummer, Head-Branch, Autor), Repo, CI (passing/failing/running/no checks), Merge-Zustand (ready/blocked/conflicts/checking), Review (approved/changes requested/review required/keins), Draft ja/nein, Autor, Base-Branch, „hat Agent" ja/nein.
- **Clustering:** keins, Repo, Merge-Zustand, CI, Review, Autor, Agent; je Cluster ein Header mit Trefferzahl.
- **Sortierung:** zuletzt aktualisiert (Standard), merge-bereit zuerst, Nummer, Titel, Repo; auf-/absteigend.
- Gesamtzähler „x von y" und „Filter zurücksetzen".
  Der rechte Split-Pane zum Öffnen eines PRs (Electron) bleibt wie heute.

## Why

DevOrbit ist Hapes ADE (agentische Entwicklungsumgebung, `docs/VISION.md`); die Kette Issue ↔ Agent ↔ Branch ↔ PR ist das Kernobjekt. Parallele Agents erzeugen viele PRs; das Summary-Bar-Popover zeigt sie, ist aber zu klein und ohne Filter. Hape will sie wie das Board als eigenen Modus abarbeiten.

## Guardrails

- Datenbasis bleibt `PullRequestsDataContext` / `collectPullRequests` (`utils/agentSessions.ts`), weil Popover und View dieselben Zeilen zeigen sollen und es keinen zweiten Datenpfad geben soll.
- Popover der Summary-Bar (`PullRequestsPanel.tsx`) funktioniert weiter wie bisher; die Zeilen-Komponente `PullRequestList` wird geteilt, nicht kopiert.
- Filter-/Sortier-/Cluster-Logik als pure Funktion in `utils/` mit Unit-Tests (Muster: `utils/board.ts`), weil sie sonst nur über die UI testbar ist.
- Code-Ort: `components/TitleBar.tsx` (`VIEWS`), `components/AgentsView/PullRequestsPage.tsx`, `PullRequestsPanel.tsx`, `App.tsx` nur falls nötig. Keine neue Dependency; Stil wie Board (`SlicePicker`, Tailwind-Grautöne), weil das Projekt Tailwind-CDN ohne Komponentenbibliothek nutzt.
- Out of scope: PR-Aktionen (Merge, Review, Kommentar), neue Server-Endpunkte, PRs aus Repos ohne Agent-Session, Landingpage.

## Done means

| ID   | Bedingung                                                                                                                                                                                    | Nachweis                                                                                                                                         |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Titelleiste zeigt Button „Pull Requests" neben Workflows/Board/Code; Klick → `/pulls` mit `aria-pressed=true`; zweiter Klick → `/agents`                                                     | `test/TitleBar.test.tsx` erweitert (gerendert über Router, echte Klicks), grün                                                                   |
| AC-2 | Jede der 9 Filterdimensionen grenzt die Liste korrekt ein; Filter kombinieren mit UND; Freitext trifft Titel, Nummer, Head-Branch und Autor                                                  | Unit-Tests der puren Funktion, je Dimension mindestens ein Treffer- und ein Ausschlussfall, grün                                                 |
| AC-3 | Jedes der 7 Clusterings (inkl. keins) bildet Gruppen mit korrekter Trefferzahl; ein PR mit mehreren Agents erscheint im Agent-Clustering unter jedem, PRs ohne Agent in einer eigenen Gruppe | Unit-Tests, grün                                                                                                                                 |
| AC-4 | Jede der 5 Sortierungen in beiden Richtungen liefert die erwartete Reihenfolge; Standard = zuletzt aktualisiert absteigend                                                                   | Unit-Tests, grün                                                                                                                                 |
| AC-5 | Im gerenderten `/pulls`-View: Filter setzen ändert Liste und Zähler „x von y", Clustering zeigt Header mit Zahlen, „Filter zurücksetzen" stellt alles her                                    | `test/pullRequestsView.test.tsx` erweitert, über `ConnectedPullRequestsPage` mit Context-Daten (Testing Library, echte Events), grün             |
| AC-6 | Filter-, Cluster- und Sortierzustand steht in den URL-Search-Params von `/pulls`; Neuladen bzw. Aufruf der URL stellt ihn wieder her; der bisherige Repo-Filter geht darin auf               | Test in AC-5-Datei mit `MemoryRouter initialEntries` inkl. Params, grün                                                                          |
| AC-7 | Popover der Summary-Bar zeigt weiter alle PRs und öffnet `/pulls` über den Maximize-Button                                                                                                   | bestehende Popover-Tests unverändert grün                                                                                                        |
| AC-8 | Typen und Testsuite grün                                                                                                                                                                     | `bunx tsc --noEmit` und `bunx vitest run` ohne Fehler, Ausgabe im PR                                                                             |
| AC-9 | Endzustand sichtbar: View mit aktivem Filter und Clustering nach Repo, Titelleiste mit aktivem Button                                                                                        | Screenshots aus dem laufenden Dev-Server (Playwright) im PR unter `## Screenshots`, plus GIF: Button-Klick → Filter setzen → Clustering wechseln |

Stopp-Regel: weiterarbeiten bis alle AC belegt; liefert `gh` lokal keine PRs, AC-9 mit Fixture-Daten im Context belegen und das im PR sagen.

## Ambition

- Altitude: PR-Liste später mit Board-Items verknüpfen (Issue ↔ PR in einer Ansicht); nur Vorschlag, nicht Scope.
- Depth: Filter auf allen Feldern von `AgentPullRequest` statt Auswahl; Ziel: Filterwechsel ohne spürbare Verzögerung bei 200 PRs (pure Funktion, `useMemo`).
- Crew: tut, was eine A11y-Prüferin tut: alle Bedienelemente per Tastatur erreichbar, Labels für Screenreader, Fokus bleibt nach Filterwechsel in der Leiste.

## Prüfung

langlebig · unabhängig · dauerhafter Modus der App, den Hape täglich nutzt und auf dem spätere Board-Verknüpfung aufbaut.

## First on approval

`ViewToggles` in `components/TitleBar.tsx` um `/pulls` ergänzen und die pure Filter-/Sortier-/Cluster-Funktion samt Tests in `utils/` anlegen.

## Annahmen

- „Alle offenen PRs" = alle PRs der Repos, in denen Agent-Sessions laufen (dieselben wie im Modal); keine gh-Abfrage über alle GitHub-Repos (vorgeschlagen)
- Zustand in URL-Search-Params statt localStorage, weil teilbar und Zurück-Taste funktioniert (vorgeschlagen)
- Bedienleiste kompakt über der Liste, nicht als Seitenleiste, damit der PR-Split-Pane Platz behält (vorgeschlagen)
- `ui: on` für dieses Issue, da sichtbare UI mit neuer User Journey (vorgeschlagen)
