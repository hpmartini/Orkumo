# Briefing: Issues anlegen und bearbeiten (DevHub #72)

## The Job

In DevOrbit lassen sich GitHub-Issues direkt anlegen und vollständig bearbeiten, ohne zu GitHub zu wechseln.

- **Anlegen im Board** (`/board`): jede Spalte hat ein „+ Issue“. Das neue Issue landet im gewählten Repo, wird dem Board-Project (Default MACC) hinzugefügt und bekommt den Status dieser Spalte. Ist im Rail ein Repo-Slice aktiv, ist dieses Repo vorbelegt; sonst Repo-Auswahl (zuletzt genutztes vorbelegt).
- **Anlegen unter Agents** (`/agents`): jede Projekt-Gruppe im Rail (`components/AgentsView/ProjectsRail.tsx`) hat „+ Issue“ für das GitHub-Repo dieses Projekts (Slug aus dem Origin-Remote, `parseGithubSlug`). Das Issue kommt ebenfalls aufs Board-Project.
- **Bearbeiten** im Seitenpanel `components/BoardView/BoardItemPanel.tsx`: alle Felder, die GitHub am Issue editierbar anbietet — Titel, Beschreibung (Markdown mit Vorschau), Zustand (schließen als completed/not planned, wieder öffnen), Labels, Assignees, Milestone, Issue-Type, Parent und Sub-Issues, Status und weitere Felder des Board-Projects. Erreichbar ist das Panel auch aus `/agents` über die bestehenden Issue-Chips.
- Formular für Anlegen und Bearbeiten ist dieselbe Komponente.

## Why

Hape steuert seine Arbeit über GitHub-Issues, die Agents per `mw board` abarbeiten (Leitbild `docs/VISION.md`: Kontext Issue ↔ Agent ↔ Branch ↔ PR in einer Umgebung). Heute muss er für jedes neue oder zu korrigierende Issue zu github.com wechseln; das bricht den Fluss. Ziel dahinter: Aufgabe in DevOrbit formulieren, auf Todo ziehen, Agent arbeitet los — alles an einem Ort.

## Guardrails

- **Backend**: erweitert `server/services/boardService.js` und die Routen unter `/api/board/*` in `server/index.js`; GitHub-Zugriff wie dort über `gh` per `execFile` mit Argument-Array (GraphQL `createIssue`, `updateIssue`, `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`, `addSubIssue`/`removeSubIssue`, `closeIssue`/`reopenIssue`; REST wo GraphQL fehlt). Eingaben validieren wie die bestehenden Board-Routen. GitHub bleibt Quelle der Wahrheit; nach Schreiben Cache für das Item invalidieren statt eigene Kopie.
- Auswahllisten (Labels, Assignees, Milestones, Issue-Types, Project-Felder) pro Repo bzw. Project vom Server holen und im Speicher cachen.
- Body der Issues erst beim Öffnen des Panels laden, nicht in der Board-Abfrage, damit `/api/board/items` schnell bleibt.
- **Frontend**: Shell, Tailwind-Tokens aus `index.html`, lucide-react, `usePopover`, Dialog-Muster aus `components/CommandPalette/TaskComposerModal.tsx` (`useDialogA11y`). Keine neue UI-Bibliothek, kein Markdown-Editor als neue Dependency, wenn eine Textarea plus vorhandener Renderer reicht.
- Optimistische Anzeige mit Rücknahme bei Fehler, Fehlermeldung sichtbar (wie beim Status-Drag).
- Nur `gh`-CLI-Auth, keine Tokens aus `~/.claude` (Leitbild Prinzip 5).
- Out of scope: Löschen, Transfer, Lock, Pin, Kommentare schreiben, Draft-Issues anlegen, PRs bearbeiten, Templates/Issue-Forms.
- Annahme: „alle Felder“ = die oben gelisteten Issue-Felder plus Project-Felder; Aktionen (Lock, Transfer, Pin, Löschen) zählen nicht dazu.
- Annahme: Anlegen unter Agents setzt Project-Status „Backlog“ (nicht Todo), damit kein Agent ungewollt startet.
- Annahme: Projekte ohne GitHub-Origin zeigen unter Agents kein „+ Issue“.
- Annahme: Issue-Type nur anzeigen, wenn das Repo/Owner Issue-Types hat (User-Repos haben sie oft nicht).

## Done means

- Im Board: „+ Issue“ in Spalte „Todo“ legt in `hpmartini/DevHub` ein Testissue an; per `gh issue view` und GraphQL-Abfrage aufs Project belegt: existiert, ist auf MACC, Status Todo. Gleiches unter `/agents` für die DevOrbit-Projektgruppe (Status Backlog).
- Jedes oben gelistete Feld im Panel geändert und per `gh` nachgeprüft; Board zeigt die Änderung ohne manuellen Refresh. Testissues danach schließen und mit Label/Titel als Test kennzeichnen.
- Unit-Tests (Vitest) für Validierung und Mapping der neuen Service-Funktionen; `bun run build`, Lint, Vitest grün. Status-Drag, Board-Polling und `/agents` funktionieren unverändert.
- Screenshots von Anlege-Dialog und Bearbeiten-Panel im PR.
- Weiterarbeiten, außer ein benötigter `gh`-Scope fehlt (dann berichten, nicht umgehen).
- Rückmeldung: kurzer Bericht, was getan, was angenommen.

## First on approval

Per `gh api graphql` prüfen, welche Mutationen und Felder (Issue-Types, Project-Felder von MACC, Sub-Issues) mit dem vorhandenen Token gehen, und daraus `POST /api/board/issues` (Anlegen + Project + Status) bauen.
