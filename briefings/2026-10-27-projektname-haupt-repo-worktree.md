# Briefing: Projektname = Haupt-Repo, auch bei Worktrees

Issue: https://github.com/hpmartini/DevHub/issues/52 (Teil von #45, Epic #58)

## The Job

Jede Agent-Session, die in einem Git-Worktree läuft, erscheint im Agents-Rail (Gruppierung „Project“) unter dem Namen und in der Gruppe ihres Haupt-Repos, nie unter dem Worktree-Ordner. Das gilt für Worktrees unter `<repo>/.claude/worktrees/…` bzw. `<repo>/.worktrees/…` und für Worktrees außerhalb des Repos (`git worktree add ../x`).

## Why

Hape steuert viele parallele Agents, fast alle in eigenen Worktrees (mw-Läufe, Board-Sessions). Heißt ein Projekt wie der Worktree, zerfällt ein Repo in viele Gruppen und Dispatch-Ziel, Favorit und Ordnung greifen nicht. Ziel dahinter (Leitbild, `docs/VISION.md`): Kontext Issue ↔ Agent ↔ Worktree ↔ PR muss am Repo hängen.

Befund (Code auf `origin/main`, 2026-10-27): Der Kern ist schon da (Commit `bf8bbe5`).

- Server: `resolveRepoIdentity` in `server/services/agentContextService.js` liefert für linked worktrees den Namen des Hauptcheckouts (aus `--git-common-dir`), getestet inkl. echtem `git worktree add` in `test/agentContextService.test.js`.
- Client: `mainRepoPath`/`repoName`/`projectGroups` in `utils/agentSessions.ts` gruppieren `.claude/worktrees` und `.worktrees` schon vor dem Kontext-Load mit dem Hauptcheckout; Tests in `test/agentSessions.test.ts`.
- Lücke: Worktrees außerhalb des Repos bekommen nach dem Load zwar den richtigen Titel (`repo.name`), aber eigenen Gruppen-Key `project:dir:<worktree-pfad>` (Shortcut-Kommentar über `mainRepoPath`). Zwei Gruppen gleichen Namens.

## Guardrails

- Lücke schließen, indem der Server-Kontext den Pfad des Hauptcheckouts mitliefert (dirname des common git-dir, bei Bare-Repos der Repo-Ordner) und `projectGroups` ihn für Key und `cwd` nutzt, sobald er da ist; davor bleibt der pfadbasierte Fallback. Shortcut-Kommentar danach entfernen.
- Überschneidung mit #96 (Briefing `briefings/2026-10-26-projekt-gruppen-github-name.md`, steht auf `mw:build`): #96 plant dasselbe Feld („Toplevel des Hauptcheckouts im Kontext“). Ist #96 beim Start auf `origin/main` oder `macc/58` schon gemerged/gepusht, dessen Feld nutzen und nur fehlende Tests ergänzen, statt ein zweites Feld einzuführen.
- Gruppen-Key soll beim Nachladen der Kontexte nicht springen, wo es vermeidbar ist (Collapse/Ordnung hängen daran, Kommentar in `projectGroups`). Bei externen Worktrees ist ein einmaliger Wechsel nach dem Load unvermeidlich und ok.
- Annahme: Scope ist der Agents-Rail (Gruppierung „Project“ + Sortierung „Repository“). Dashboard-App-Liste, Board-Rail und Scanner bleiben unverändert.
- Annahme: Kein Bedarf, externe Worktrees ohne Server-Kontext rein über den Pfad aufzulösen (geht nicht ohne `.git`-Datei zu lesen).

## Done means

- Unit-Tests in `test/agentSessions.test.ts`: externe Worktree-Session (`/w/x`, Kontext mit Hauptcheckout `/code/proj`) + Session in `/code/proj` → eine Gruppe „proj“; `.claude/worktrees`-Fälle bleiben grün. Server-Test: `gitInfo` mit echtem `git worktree add ../x` liefert Name und Hauptcheckout-Pfad.
- `bun run test` und `bun run build` grün; Gruppierungen none/status/directory unverändert.
- Rückmeldung: PR auf Branch `macc/58` mit `Closes https://github.com/hpmartini/DevHub/issues/52` und `## Review-Anleitung`; Kurzbericht, welche Annahme gegriffen hat (eigenes Feld oder #96-Feld).

## First on approval

`git log origin/main origin/macc/58 -- server/services/agentContextService.js` prüfen, ob #96 das Hauptcheckout-Feld schon liefert; danach failing Test für den externen Worktree schreiben.
