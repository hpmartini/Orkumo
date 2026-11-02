# Briefing: New Agent / New Issue im Agents View, ⌘+Enter, Bilder (DevHub #105)

## The Job

Im Agents View (`/agents`) kann Hape direkt am Projekt Issues anlegen und Agents starten:

- Rechtsklick auf eine Projektgruppe in der Rail → Kontextmenü mit „New Issue“ (Repo der Gruppe) und „New Agent“ (Ordner der Gruppe vorausgewählt).
- Kopfzeile der Rail: neben „+ New task“ zwei weitere Buttons „+ New Agent“ und „+ New Issue“.
- „New Agent“ öffnet ein Modal mit Ordnerwahl (Standard: Home-Verzeichnis) und optionalem Prompt; es startet eine interaktive Claude-Session und hängt sie sofort im Workspace an. „New task“ bleibt der Hintergrund-Auftrag (`claude --bg` mit Pflicht-Prompt).
- In allen drei Modals (Task, Agent, Issue): Enter = neue Zeile, ⌘+Enter (Ctrl+Enter auf Nicht-Mac) = absenden.
- Bilder anhängen (Einfügen aus Zwischenablage, Drag & Drop, Dateiauswahl) in allen drei Modals:
  - Task/Agent: Bilder bleiben lokal, werden serverseitig abgelegt und dem Agent wie in Claude Code als Bild mitgegeben (Dateipfad im Prompt), kein Upload.
  - Issue: Bilder werden auf GitHub hochgeladen und im Issue-Body eingebettet; ein Agent, der das Issue später bearbeitet, bekommt sie über diese Links.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`); Kernobjekt ist Issue ↔ Agent ↔ Worktree ↔ PR. Hape will Arbeit dort anstoßen, wo er gerade auf ein Projekt schaut, ohne in Board, Terminal oder github.com zu wechseln, und Screenshots so mitgeben wie in Claude Code.

## Guardrails

- Bestehendes wiederverwenden: `IssueCreateModal` (`components/BoardView/`), `onCreateIssue`/„+“ pro Gruppe und `openMenu` in `components/AgentsView/AgentList.tsx`, `TaskComposerModal` + `DispatchInput`, `DirectoryPicker`, `doDispatch`/`attach` in `AgentsView.tsx`, `useDialogA11y`, `lastIssueRepo`/`useRepoOptions`. Server: `server/services/agentService.js` (Dispatch), `server/services/boardService.js` (Issues via `gh`).
- Server-Routen mit `validate(...)`-Schema und bestehendem Limiter wie die Nachbarrouten; Bild-Uploads auf Bildtypen und Größe begrenzen, Dateinamen serverseitig vergeben, weil Pfade sonst aus Client-Eingaben entstehen.
- Issue-Bilder: Die GitHub-API hat keinen Bild-Upload. Entscheidung Hape: Bilder per `gh api` (Contents-API) in einen eigenen Branch `issue-assets` im Ziel-Repo committen (Branch bei Bedarf anlegen) und per Raw-URL im Body einbetten. DevHub ist öffentlich, die Bilder also auch; im Modal kurz darauf hinweisen.
- Annahme: Der Shortcut gilt auch für „New task“, weil es dasselbe `DispatchInput` nutzt. Bisheriges „Ctrl/⌘+Enter = absenden und anhängen“ wandert auf ⌘+Shift+Enter; `ShortcutsHelp.tsx`, Tooltips und den Doc-Kommentar in `DispatchInput.tsx` anpassen. Ctrl+J bleibt.
- Annahme: Interaktive Session = Weg, den „absenden und anhängen“ heute schon nimmt, ohne Pflicht-Prompt; geht `claude --bg` nicht ohne Prompt, den bestehenden Attach-/PTY-Pfad für eine neue Session nutzen statt eines neuen Mechanismus.
- Annahme: Lokale Bilder liegen unter einem DevOrbit-Datenpfad (`getDataPath`) und werden nicht automatisch gelöscht.
- Annahme: Kontextmenü nur für Projektgruppen; „New Issue“ dort deaktiviert, wenn die Gruppe kein GitHub-Repo hat. „+ New Issue“ in der Kopfzeile nimmt das Repo der ausgewählten Gruppe, sonst `lastIssueRepo`.
- Out of scope: Issue-Modal mit Kommentaren (#104), Board-View, Remote-Agents.

## Done means

- Rechtsklick → New Issue / New Agent sowie beide neuen Buttons funktionieren; New Agent mit Standard-`~` und gewähltem Ordner öffnet eine angehängte Session.
- ⌘+Enter sendet, Enter erzeugt Zeilenumbruch in allen drei Modals.
- Agent mit eingefügtem Screenshot beschreibt dessen Inhalt; Test-Issue `[Test #105] …` mit Bild zeigt das Bild auf github.com (danach schließen). Playwright-Screenshots im PR.
- Unit-Tests für Tastenlogik und Prompt-/Body-Aufbau mit Bildern, Server-Test für Upload-Validierung.
- `bun run test`, `tsc --noEmit`, lint, `bun run build` grün, Ausgabe gezeigt.
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/105` und `## Review-Anleitung`. Weiterarbeiten außer bei fehlenden `gh`-Rechten; dann berichten.
- Rückmeldung: kurze Liste geändert / angenommen / offen.

## First on approval

Prüfen, wie „absenden und anhängen“ heute eine Session startet und anhängt, und ob das ohne Prompt geht; davon hängt der New-Agent-Pfad ab.
