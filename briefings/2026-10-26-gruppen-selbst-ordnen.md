# Briefing: Agents-Liste – Gruppen selbst ordnen (DevHub #47)

## The Job

In der linken Agents-Leiste (Agents View, `/agents`) ordnet Hape die Gruppen aller Gruppierungen (Project, Status, Directory) per Drag & Drop oder per „Move up/down“ (Gruppenmenü und Tastatur-Reorder) selbst. Die Reihenfolge ist je Gruppierung gespeichert und überlebt einen Reload. Die Standard-Gruppierung für frische Einstellungen ist **Project**.

Stand auf Branch `macc/45` (Commit `bf8bbe5`, auch in `main`): Ordnen ist weitgehend gebaut – `hooks/useRailPreferences.ts` (`applyGroupOrder`, `moveGroup`, `groupNeighbour`, Persistenz in localStorage `devOrbitAgentRail.v1`, je Modus), Drag & Drop und Menü in `components/AgentsView/AgentList.tsx`, Tastatur in `AgentsView.tsx` (`handleReorder`), Tests in `test/railPreferences.test.ts`. Gefundene Lücke: Standard-Gruppierung ist noch `'state'` in `types.ts` (`DEFAULT_AGENT_VIEW_SETTINGS`) und `server/services/settingsService.js`. Die Aufgabe ist also: Lücken schließen und das Verhalten belegen, nicht neu bauen.

## Why

Hape arbeitet in DevOrbit als ADE (agentische Entwicklungsumgebung, `docs/VISION.md`) und will die Leiste wie einen Datei-Baum nutzen (Sammelissue #45, Runde 5). Wichtige Projekte sollen oben stehen und dort bleiben; Project ist die Ansicht, mit der er startet.

## Guardrails

- Bestehende Mechanik in `useRailPreferences.ts` wiederverwenden; keine zweite Ordnungslogik, keine neue Abhängigkeit für Drag & Drop.
- Favoriten-Gruppe bleibt fix oben und nicht verschiebbar; favorisierte Gruppen bilden einen eigenen Block (bestehende Regel in `groupNeighbour`).
- Neue, noch nie geordnete Gruppen landen am Ende ihres Blocks (bestehendes Verhalten).
- Sortierung der Agents innerhalb einer Gruppe (`reorderAgents`) ist nicht Teil dieses Issues.
- Geschwister-Issues #46, #48–#56 auf demselben Branch nicht anfassen.
- Annahme: Speicherung pro Browser (localStorage) genügt für „bleibt gespeichert“; keine Server-Persistenz.
- Annahme: Default auf `'project'` gilt nur für frische Einstellungen; eine gespeicherte Gruppierung des Users wird nicht migriert.
- Annahme: Gruppierung „None“ hat nur eine Gruppe und bleibt ohne Ordnen.

## Done means

- `DEFAULT_AGENT_VIEW_SETTINGS.grouping` ist `'project'` in `types.ts` und `server/services/settingsService.js` (Kommentar dort aktualisiert).
- Test belegt: Reihenfolge nach `moveGroup` wird gespeichert und nach erneutem `load` (simulierter Reload) gleich angewendet, je Modus getrennt; ein Test belegt den Default `'project'`.
- `bun run test` (bzw. vitest) und `bun run build` grün, Ausgabe gezeigt.
- Im laufenden App-Fenster per Playwright: in Project zwei Gruppen per Drag & Drop tauschen, Reload, Reihenfolge gleich; Screenshot im PR.
- Unverändert: Einklappen, Favoriten, Agent-Reihenfolge in Gruppen.
- PR gegen `main` von `macc/45` mit `Closes https://github.com/hpmartini/DevHub/issues/47` und `## Review-Anleitung`. Weiterarbeiten außer bei Merge-Konflikten mit Geschwister-Issues; dann berichten.
- Rückmeldung: kurze Liste, was geändert, was nur verifiziert, welche Annahmen.

## First on approval

Worktree auf `origin/macc/45` anlegen und `test/railPreferences.test.ts` laufen lassen, um den Ist-Stand zu bestätigen.
