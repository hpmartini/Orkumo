# Briefing: Issues anlegen in der Desktop-App, Meldung „falsches Verzeichnis“ (#106)

## The Job

In der Desktop-App (Electron, aus Finder/Dock gestartet) legt Hape Issues an, im Board („+“ in einer Spalte) und unter `/agents` („+“ am Projekt-Gruppenkopf), ohne Fehlermeldung. Ergebnis: ein PR gegen `main`, der entweder den echten Fehler behebt oder, falls `main` schon funktioniert, den Nachweis liefert und die Ursache benennt. Dazu klare Schritte, wie Hape die App neu baut und prüft, dass der neue Build läuft.

## Why

Hape steuert die mw-Pipeline über neue Issues und Labels aus DevOrbit (`docs/VISION.md`: DevOrbit als ADE). Gemeldet in #106 (Wortlaut: „Mindestens in der electron App kann ich keine Issues anlegen. Ich bekomme die Meldung, das falsche Verzeichnis sei ausgewählt. Was nicht stimmt“). Danach soll Hape sich auf den Desktop-Build verlassen können, statt auf github.com auszuweichen.

Befund aus der Vorbereitung (geprüft 27.10.):

- Installierte App: `/Applications/DevOrbitDashboard.app`, Build 26.10. 18:24. Enthält #82 (`/api/board/issues`, `repo-options`), aber nicht `b5d2888` (Homebrew-PATH für `gh`): `grep -c "'/opt/homebrew/bin', // gh" app.asar` = 0. Aus Finder gestartet scheitert dann jeder `gh`-Aufruf mit `gh failed: spawn gh ENOENT` (so in PR #114 zu #95 nachgestellt).
- PR #114 (#95, gemerged) hat Anlegen/Labels auf `main` in Electron nachgewiesen und vermutet für #106 dieselbe Ursache, aber nicht bestätigt.
- Im Issue-Anlegen-Pfad (`IssueCreateModal.tsx` → `POST /api/board/issues` → `boardService.createIssue`) gibt es keine Meldung über ein Verzeichnis. Nächster Kandidat: `server/services/agentService.js:469` („… is outside the configured project directories …“, Agent-Start) und `AgentsView.tsx:641` („Pick a directory first“).
- Der Server der installierten App lief beim Check nicht (Port 3001 antwortete nicht), obwohl der Renderer lief.

## Guardrails

- Eigener Worktree auf Basis `origin/main`, weil Hape im Haupt-Checkout arbeitet.
- Bestehende Wege weiterverwenden (`boardService.js`, `IssueCreateModal.tsx`, `AgentList.tsx`, `electron/main.js`); neu bauen nur, was nachweislich kaputt ist.
- `/Applications` nicht überschreiben und nicht releasen; Neubau und Installation macht Hape.
- Testlauf wie in #114: Electron von `main` unpackaged mit Finder-PATH (`/usr/bin:/bin:/usr/sbin:/sbin`), eigenes `--user-data-dir`, freier `SERVER_PORT`; Hapes laufende App und Port 3001 nicht anfassen.
- Annahme: Die Meldung stammt aus dem veralteten Build oder vom Agent-Start, nicht vom Anlegen selbst. Ziel ist, den Ursprung der Verzeichnis-Meldung im Code zu belegen. Tritt auf `main` ein echter Fehler auf (Anlegen, Repo-Wahl, Agent-Start nach Anlegen, falsche `repo`-Zuordnung einer Projektgruppe nach #96), wird er im selben PR behoben, mit Test.
- Annahme: Liegt der Wortlaut nicht im Code und `main` funktioniert, schließt der PR mit Nachweis und der Bitte, die genaue Meldung nach dem Neubau als Kommentar zu liefern.
- Annahme: Build-Commit/-Datum in der App anzeigen ist out of scope (nur als Vorschlag im PR); ebenso weitere Issue-Felder.

## Done means

- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/106` und `## Review-Anleitung` (Build prüfen per `grep` wie in #114, `bun run electron:build:mac`, App installieren, aus Dock starten, Board „+“ und `/agents` „+“ testen).
- Nachweis im Electron-Lauf mit Finder-PATH: Issue im Board und aus `/agents` angelegt, bestätigt per `gh issue view <n> --json labels,projectItems`; Screenshots im PR. Testissues `[Test #106] …`, danach als not planned geschlossen.
- PR nennt die Herkunft der Verzeichnis-Meldung (Datei:Zeile) oder dass sie im Code nicht existiert.
- `bun run test`, `tsc --noEmit`, `bun run build` grün, Ausgabe gezeigt.
- Weiterarbeiten außer bei fehlenden `gh`-Rechten oder wenn Electron nicht startbar ist; dann berichten.
- Rückmeldung: kurz, was getan, was angenommen, Testissue-Nummern.

## First on approval

Worktree von `origin/main` anlegen, Electron mit Finder-PATH auf freiem Port starten und im Board ein Testissue anlegen.
