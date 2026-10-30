# Briefing: Server-Panel – Systemlast je Server (DevHub #55)

## The Job

Das Panel „Running servers“ im Agents View zeigt je Server CPU% und RAM, aktualisiert alle ~5 s nur bei offenem Panel, und behandelt Fehler und verschwundene Prozesse sichtbar sauber. Der Kern ist bereits auf `main` (Commit `bf8bbe5`, Runde 5 von #45): `components/AgentsView/ServersPanel.tsx`, `hooks/useServerStats.ts`, `services/agentsApi.ts#fetchServerStats`, Route `GET /api/agents/servers/stats` in `server/index.js`, `server/services/processStatsService.js` (+ `test/processStatsService.test.js`). Ergebnis dieses Auftrags: die verbleibenden Lücken schließen und die Fertig-Kriterien des Issues per Test belegen, statt neu zu bauen.

Bekannte Lücken:

- Schlägt ein Refresh fehl, bleiben die letzten Werte stehen, ohne Hinweis, dass sie veraltet sind (bei dauerhaftem Fehler unbegrenzt).
- Server ohne `pid` und verschwundene Prozesse zeigen beide nur „–“, ohne Unterscheidung oder Tooltip.
- `useServerStats` hat keinen Test (Polling-Stopp beim Schließen/Unmount, Abbruch laufender Requests, `document.hidden`).

## Why

DevOrbit ist Hapes Arbeitsumgebung für agentische Entwicklung (Säule Agents und Mesh, Epic #60, Sammelissue #45; Leitbild `docs/VISION.md`). Hape will beim Blick in die Server-Liste sofort sehen, welcher Agent-Server Last frisst, und sich auf die Zahlen verlassen können. Falsche, eingefrorene Werte sind schlimmer als keine.

## Guardrails

- Auf bestehendem Code aufbauen, keine neue Stats-Quelle, keine neue Abhängigkeit; `processStatsService` (ps-basiert, inkl. Kindprozesse) bleibt, weil er auf macOS und Linux/WSL läuft.
- Server-Route bleibt auf bekannte Server-PIDs beschränkt (`getKnownServerPids`), weil sonst beliebige PIDs abgefragt werden können.
- Layout/Stil des Panels beibehalten (Tailwind, lucide-react, bestehende Spaltenbreiten).
- Out of scope: Charts/Verlauf, Schwellwert-Alarme, Stats für Agents selbst, andere Panels.
- Annahme: Veraltete Werte nach fehlgeschlagenem Refresh werden gedimmt mit Tooltip („Stand hh:mm:ss, Aktualisierung fehlgeschlagen“) angezeigt; nach mehreren Fehlschlägen in Folge (z.B. 3) auf „–“.
- Annahme: Prozess weg → „–“ mit Tooltip „Prozess beendet“; kein `pid` → „–“ mit Tooltip „keine PID bekannt“.
- Annahme: Arbeit auf Branch `macc/45` (offener PR #89), eigene `Closes https://github.com/hpmartini/DevHub/issues/55`-Zeile im PR-Body.

## Done means

- CPU% und RAM je Server sichtbar; Polling läuft nur bei offenem Panel und sichtbarem Tab, stoppt beim Schließen (kein Request nach Unmount).
- Fehlschlag und verschwundener Prozess zeigen den Zustand wie oben an, ohne Crash oder Konsolenfehler.
- Beleg: neuer Unit-Test für `useServerStats` (Fake-Timer, gemocktes `fetchServerStats`: Intervall, Stopp bei Unmount, Fehler → stale, PID fehlt → entfernt) plus bestehende `test/processStatsService.test.js`; komplette Test-Suite und `bun run build` grün.
- Unverändert: API-Form `{ stats: AgentServerStats[] }`, Limit 50 PIDs.
- Stopp nur, wenn die Annahmen oben mit dem vorhandenen Code kollidieren; sonst durcharbeiten.
- Rückmeldung: kurzer Bericht, was geändert, welche Annahmen gezogen, Testausgabe; PR-Body mit `## Review-Anleitung` (Panel öffnen, Server starten/killen, Netzwerk im DevTools drosseln/blocken).

## First on approval

Worktree auf `origin/macc/45` anlegen und `hooks/useServerStats.ts` samt Test-Setup (Vitest/Jest-Konfiguration im Repo) lesen, um den Hook-Test als Erstes zu schreiben.
