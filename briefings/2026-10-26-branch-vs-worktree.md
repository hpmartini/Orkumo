# Briefing: Branch vs. Worktree mit Branch klar unterscheiden (#53)

## The Job

Stand: Die drei Kriterien aus #53 (eigenes Icon/Label für Worktree, Branch bleibt sichtbar, Tooltip nennt Worktree-Pfad) sind seit Commit `bf8bbe5` (nach dem Issue entstanden, refs #53) auf `main` umgesetzt: `components/AgentsView/AgentList.tsx` zeigt `GitBranchPlus` + Chip „worktree“ neben Repo-Name und Branch, Tooltip über `worktreeTitle()` mit Name und Pfad; Server-Erkennung `isWorktree/worktreeName/worktreePath` in `server/services/agentContextService.js:76-90`, getestet in `test/agentContextService.test.js`.

Restlücke, die dieser Job schließt: Die ganze Repo/Branch/Worktree-Zeile hängt an `ctx?.repo`. Solange der Kontext fehlt (Kontexte laden noch, Git-Abfrage scheitert, Verzeichnis weg), zeigt die Zeile nichts, obwohl `session.worktree` aus dem Job-State bekannt ist (`agentService.js:594`). Ergebnis: Auch ohne geladenen Kontext erkennt man in der Liste, dass ein Agent in einem Worktree läuft (gleiches Icon/Chip, Tooltip mit Pfad aus `session.worktree`, Repo-Name über `mainRepoPath`/`repoName` aus `utils/agentSessions.ts`). Sobald `ctx.repo` da ist, gilt die bestehende Anzeige unverändert.

## Why

DevOrbit ist Hapes Arbeitsumgebung für agentische Entwicklung (docs/VISION.md, Säule Kontext-Verknüpfung, Epic #58). Hape muss beim Überfliegen vieler paralleler Agents sofort sehen, wer im Haupt-Checkout arbeitet (Kollisionsgefahr mit seiner eigenen Arbeit) und wer isoliert im Worktree.

## Guardrails

- Bestehende Anzeige und Server-Erkennung nicht umbauen, nur den Fallback ergänzen; Logik für den Fallback als reine Funktion in `utils/agentSessions.ts`, weil die dort unit-getestet wird.
- Out of scope: `RemoteAgents.tsx` (#57), `BoardRail`, `PeekPanel` (zeigt den Pfad schon), Optik des bestehenden Chips.
- Annahme: Kriterien 1–3 gelten durch `bf8bbe5` als erfüllt. Gefällt Hape die Optik nicht, ist das ein neues Issue. Ist der Fallback nicht gewollt: Issue schließen statt `mw:build`.
- Annahme: Ohne Kontext ist der Branch unbekannt; dann nur Worktree-Hinweis ohne Branch, kein Raten aus dem Ordnernamen.
- Branch `macc/58` (existiert noch nicht auf origin), Worktree unter `.claude/worktrees/`, PR gegen `main`.

## Done means

- Session mit `worktree` und ohne `ctx.repo` zeigt Worktree-Icon/Chip, Tooltip enthält den Pfad; Session ohne beides zeigt weiterhin nichts.
- Neue Fälle in `test/agentSessions.test.ts`; `bun run test:run` grün, Ausgabe im Bericht. `bun run build` grün.
- PR-Body mit `Closes https://github.com/hpmartini/DevHub/issues/53` und `## Review-Anleitung`. Bericht kurz: getan, angenommen, offen.

## First on approval

`git fetch origin && git worktree add .claude/worktrees/macc-58 -b macc/58 origin/main`, dann in `AgentList.tsx` die von `ctx?.repo` abhängige Zeile lesen.
