# Briefing: Issues anlegen und Labels vergeben in der Desktop-App (#95)

## The Job

In der installierten Desktop-App (`/Applications/DevOrbitDashboard.app`) kann Hape im Board und unter `/agents` Issues anlegen und Labels vergeben, auch die `mw:*`-Labels, mit denen er das Workflows-Plugin (mw board) steuert. Ergebnis ist ein PR gegen `main`, der dafür sorgt, dass ein Desktop-Build von `main` das kann, plus eine kurze Anleitung, wie Hape die App neu baut und installiert.

## Why

Hape steuert die mw-Pipeline über Labels (`mw:go`, `mw:build`, `mw:dynamic`) und neue Issues. Solange das nur auf github.com geht, ist DevOrbit als Kommandozentrale nutzlos. #72 hat das Feature gebaut (PR #82, auf `main` seit 25.10.); in der App kommt es nicht an.

Befund aus der Vorbereitung (Fakten, geprüft am 26.10.):

- Die installierte App stammt vom 26.10. 10:43 und wurde im Haupt-Checkout vom Branch `chore/drop-native-windows` (HEAD `276b925`) gebaut. Der Branch liegt 31 Commits hinter `origin/main` und enthält #82 nicht.
- Im Bundle fehlen `/api/board/issues`, `repo-options` und „Neues Issue“; `/api/board/items` ist da. Das alte Board ohne Anlegen/Bearbeiten läuft also.
- `276b925` („Electron: add /opt/homebrew/bin to PATH so gh is found“) ist nur auf diesem Branch, nicht auf `main`. Ohne ihn findet die App `gh` nicht (Board spawn `gh` ENOENT), und alle Schreibwege von #82 laufen über `gh api graphql`.

## Guardrails

- Arbeit im eigenen Worktree auf Basis `origin/main`; den Haupt-Checkout und Hapes Branch nicht anfassen, weil Hape dort arbeitet. `276b925` per Cherry-pick übernehmen.
- Bestehende Implementierung aus #82 weiterverwenden (`server/services/boardService.js`, `components/BoardView/IssueCreateModal.tsx`, `IssueEditors.tsx`, `IssueFields.tsx`, `BoardItemPanel.tsx`, `AgentsView/AgentList.tsx`). Neu bauen nur, was im Desktop-Build nachweislich fehlt oder kaputt ist.
- Nicht `/Applications` überschreiben und nicht releasen; das macht Hape nach dem Review.
- Annahme: Ursache ist allein der veraltete Build plus der fehlende PATH-Fix. Zeigt der Test aus `main` trotzdem einen echten Fehler (z. B. Labels-Picker leer, `mw:*`-Labels fehlen, Anlegen scheitert in Electron), wird er im selben PR behoben.
- Annahme: Keine Build-/Commit-Anzeige in der App als Schutz gegen veraltete Builds; nur im PR als Vorschlag nennen.
- Out of scope: weitere Issue-Felder, Kommentare, Löschen/Transfer.

## Done means

- PR gegen `main` mit `276b925` und ggf. Fixes; `Closes https://github.com/hpmartini/DevHub/issues/95`.
- Nachweis in einem Electron-Lauf aus dem Worktree (`bun run electron:dev` auf freien Ports oder gepackter Build): Board → „+“ in Todo → Issue mit Label `mw:dynamic` angelegt; im Panel Label ergänzt und entfernt; aus `/agents` ein Issue angelegt. Gegenprüfung per `gh issue view <n> --json labels,projectItems`. Screenshots im PR. Testissues `[Test #95] …`, danach geschlossen.
- vitest, `tsc --noEmit`, lint, `bun run build` grün.
- PR-Body mit `## Review-Anleitung`: wie Hape `main` auscheckt, die App baut (`bun run electron:build:mac`) und installiert, und woran er erkennt, dass die neue Version läuft.
- Rückmeldung: kurz, was getan, was angenommen, Testissue-Nummern.

## First on approval

`git fetch origin`, Worktree von `origin/main` anlegen, `276b925` cherry-picken und die App per `electron:dev` starten, um Anlegen und Labels im Electron-Kontext zu prüfen.
