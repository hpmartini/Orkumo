# Briefing: Eine Projektliste für Kontexte, Agents-Panel und Dashboard (Issue #133)

## The Job

DevOrbit kennt genau eine Projektliste. Jedes Repo, in dem Hape arbeitet, taucht darin auf: Node- und Docker-Projekte wie heute, dazu jedes Git-Repo in den konfigurierten Verzeichnissen und jedes Haupt-Repo, in dem ein Agent läuft oder lief, auch außerhalb der konfigurierten Verzeichnisse. Der Dialog „Neuer Kontext“ (`components/ContextDialog.tsx`) bietet alle diese Projekte zur Auswahl an, und ein Kontext mit ausgewählten Projekten filtert sowohl Dashboard als auch die Projektgruppen im Agents-Panel.

## Why

DevOrbit startete als Orchestrator für Node-Prozesse; Projekte kamen nur aus dem Scanner. Heute leitet das Agents-Panel seine Projektgruppen aus den Agent-Sessions ab. Zwei Quellen, zwei Wahrheiten: im Kontext-Dialog fehlen Repos, die Hape im Agents-Panel sieht. Leitbild `docs/VISION.md`: Kernobjekt ist der Kontext Issue ↔ Agent ↔ Worktree ↔ PR ↔ Code; ein Kontext muss deshalb jedes Repo umfassen können, in dem Agents arbeiten.

Befund am Code (`origin/main` c42050f):

- `scanDirectoryRecursive` (`server/services/scannerService.js:241`) erkennt nur Ordner mit `package.json` oder Docker-Compose-Datei; Python-, Swift-, Go-Repos oder reine Doku-Repos fehlen. Dazu kommen nur konfigurierte Verzeichnisse bis `scanDepth`.
- `projectGroups` (`utils/agentSessions.ts:174`) gruppiert Sessions nach App-Pfad, sonst nach Haupt-Repo-Pfad (`project:dir:<pfad>`). Diese Gruppen haben keine App-ID und sind im Dialog nicht wählbar.
- `ContextDialog` bekommt `apps` aus `useApps` (`App.tsx:582`); Kontexte speichern `appIds` (`server/services/projectContexts.js`), IDs sind `sha256(pfad)` (`scannerService.js:13`).
- `AgentsView` bekommt `apps` statt `contextApps` (`App.tsx:~416`); der Kontext filtert das Agents-Panel also gar nicht.

## Guardrails

- Projekt-ID bleibt `sha256(pfad)`, damit bestehende Kontexte, Favoriten und Archiv-Flags gültig bleiben.
- Scanner erweitern statt zweites Register bauen: Ordner mit `.git` gilt als Projekt (Typ z. B. `generic`, ohne Start-Befehl), Rekursion stoppt dort wie bei `package.json`. Worktrees unter `.claude/worktrees/` und `.git`-Dateien (Worktree-Checkouts) zählen nicht als eigenes Projekt.
- Agent-Haupt-Repos außerhalb der Scan-Verzeichnisse: serverseitig aus den Session-`cwd`s (`server/services/agentService.js`) per `mainRepoPath`-Logik ergänzen und in dieselbe App-Liste mergen, dedupliziert per Pfad (case-insensitive, macOS).
- Start/Stop/Port-Funktionen nur für Projekte mit erkanntem Start-Befehl anbieten; generische Repos zeigen diese Controls nicht.
- Annahme: Kontext filtert im Agents-Panel die Projektgruppen; Sessions ohne Projekt im Kontext werden ausgeblendet, „Alle“ (`appIds: null`) zeigt alles wie heute.
- Annahme: Dashboard-Karten zeigen generische Repos mit, ohne Laufzeit-Controls; wer sie dort nicht will, archiviert sie (bestehende Mechanik).
- Annahme: Keine Migration nötig; bestehende `appIds` bleiben gültig.
- Out of scope: Admin-Panel-Redesign, neue Projekttypen-Erkennung (Python-Start-Befehle etc.), Board-Filter-Logik.

## Done means

- Unit-Tests: Scanner findet ein Fixture-Git-Repo ohne `package.json`, ignoriert Worktree-Checkouts; Merge von Agent-Repos dedupliziert per Pfad und erzeugt dieselbe ID wie der Scanner; `projectGroups` mappt Sessions auf die neuen Apps (keine `project:dir:`-Gruppe mehr für bekannte Repos).
- Im Browser (`bun run dev`): „Neuer Kontext“ listet jedes Projekt, das das Agents-Panel als Gruppe zeigt (Nachweis: Playwright-Abgleich Gruppen-Pfade ⊆ Dialog-Pfade, Screenshot im PR). Kontext mit zwei Projekten anlegen → Agents-Panel und Dashboard zeigen nur diese.
- `bun run build`, Typecheck, bestehende Tests grün.
- Weiterarbeiten außer bei einer Leitbild-Frage oder Datenverlust-Risiko an `settings`/Kontexten. Rückmeldung: PR-Link, RC (root cause) in einem Satz, getroffene Annahmen.

## First on approval

Worktree von `origin/main` anlegen und in `server/services/scannerService.js` die `.git`-Erkennung samt Unit-Test einbauen.
