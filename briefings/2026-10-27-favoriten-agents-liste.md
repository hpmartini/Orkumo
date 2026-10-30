# Briefing: Agents-Liste – Projekte und Agents als Favoriten (DevHub #48)

## The Job

In der linken Agents-Leiste (Agents View, `/agents`) markiert Hape Gruppen (Projekte) und einzelne Agents per Stern als Favorit. Favoriten stehen ganz oben; der Zustand überlebt einen Reload. Fertig-Kriterium aus dem Issue: Stern-Toggle an Gruppe und Agent, Favoriten-Bereich oben, Zustand bleibt nach Reload.

Stand auf Branch `macc/45` (Commit `dae181e`): Das Feature ist weitgehend gebaut.

- `hooks/useRailPreferences.ts`: `favoriteGroups` / `favoriteSessions` in localStorage `devOrbitAgentRail.v1`, `withFavoriteSessions` (favorisierte Agents wandern in eine führende Gruppe „Favorites“, ohne Duplikat), `applyGroupOrder` (favorisierte Gruppen zuerst), `groupNeighbour` (Ordnen nur innerhalb des Favoriten-/Rest-Blocks).
- `components/AgentsView/AgentList.tsx`: `FavoriteButton` (Stern, bei Hover/Fokus sichtbar, gesetzt immer sichtbar), Menüeintrag „Add to / Remove from favorites“ für Gruppe und Agent, Trennlinie nach dem Favoriten-Block.
- `test/railPreferences.test.ts`: Reducer-Tests für Toggle und `withFavoriteSessions`; ein Hook-Test, der Favoriten über einen Reload belegt, fehlt.

Die Aufgabe ist: Lücken gegen das Fertig-Kriterium finden und schließen, das Verhalten belegen, nicht neu bauen.

## Why

Hape nutzt DevOrbit als ADE (agentische Entwicklungsumgebung, `docs/VISION.md`) und will die Leiste wie einen Datei-Baum nutzen (Sammelissue #45, Runde 5). Bei vielen Projekten und Agents sollen die gerade wichtigen ohne Suchen oben stehen und dort nach jedem Neustart bleiben.

## Guardrails

- Bestehende Mechanik in `useRailPreferences.ts` und `AgentList.tsx` wiederverwenden; keine zweite Favoriten-Logik, keine neue Abhängigkeit.
- Favoriten-Gruppe „Favorites“ bleibt fix oben und nicht verschiebbar (bestehende Regel aus #47).
- Gruppen-Keys sind `project:<appId>` bzw. `project:dir:<pfad>`; Geschwister-Issue #46 (Projekt-Gruppen nach GitHub-Namen) kann Keys ändern. Favoriten hängen am Key – nicht selbst an der Key-Bildung in `utils/agentSessions.ts` arbeiten, weil das #46 gehört.
- Geschwister-Issues #46, #47, #49–#56 auf demselben Branch nicht anfassen.
- Annahme: Speicherung pro Browser (localStorage) genügt; keine Server-Persistenz.
- Annahme: Favorisierte Gruppen bleiben als eigene Gruppe oben im Favoriten-Block (mit Trennlinie), favorisierte Agents wandern in die Gruppe „Favorites“; beides zusammen gilt als „Favoriten-Bereich oben“.
- Annahme: Favorisierte Gruppen gelten über alle Gruppierungen, wirken aber nur, wo der Key existiert (Project/Directory); Stern an Status-Gruppen ist nicht nötig.
- Annahme: Verwaiste Favoriten (gelöschte Agents) dürfen liegen bleiben; Aufräumen nur, wenn trivial über vorhandenes `keepKnown`.

## Done means

- Test in `test/railPreferences.test.ts` belegt: Gruppen- und Agent-Favorit wird gesetzt, nach erneutem Mount (simulierter Reload) ist er noch da und die Gruppe steht oben bzw. der Agent in „Favorites“.
- Gefundene Lücken gegen das Fertig-Kriterium geschlossen, je mit Test.
- `bun run test` und `bun run build` grün, Ausgabe gezeigt.
- Im laufenden App-Fenster per Playwright: Project-Gruppe und einen Agent per Stern favorisieren, Reload, beide oben; Screenshot im PR.
- Unverändert: Gruppen ordnen, Einklappen, Agent-Reihenfolge in Gruppen.
- PR gegen `main` von `macc/45` (existiert ein PR, Body ergänzen) mit eigener Zeile `Closes https://github.com/hpmartini/DevHub/issues/48` und `## Review-Anleitung`. Weiterarbeiten außer bei Merge-Konflikten mit Geschwister-Issues; dann berichten.
- Rückmeldung: kurze Liste, was geändert, was nur verifiziert, welche Annahmen.

## First on approval

Worktree auf `origin/macc/45` anlegen und `test/railPreferences.test.ts` laufen lassen, um den Ist-Stand zu bestätigen.
