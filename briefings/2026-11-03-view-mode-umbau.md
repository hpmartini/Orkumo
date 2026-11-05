# Briefing: View/Mode-Umbau (DevHub#184)

## The Job

Hape wechselt Modi an einer Stelle und sieht auf zwei Dashboards, was zählt. Konkret:

- **Modusleiste links:** In der Kopfzeile des Agents-Panels (`components/AgentsView/AgentsView.tsx`, heute `Bot`-Knopf + „Agents") steht: Roboterkopf → **Kontext-Dashboard**, daneben vier Modusschalter **Agents · Workflows · Board · Code**. Die drei `ViewToggles` rechts in `components/TitleBar.tsx` entfallen. Das Agents-Panel bleibt in allen Modi sichtbar wie heute. Der aktive Modus ist markiert; Klick auf einen Modus wechselt dorthin (kein Toggle-zurück-Verhalten mehr nötig, Agents ist ein eigener Schalter).
- **Rakete links oben** → **globales Dashboard** (`/dashboard`, alle Kontexte).
- **Kontext-Dashboard** zeigt dieselben Bausteine, gefiltert auf die Projekte des aktiven Kontexts (`contextAppIds` / `useProjectContexts`), plus Tool-Versionen je Projekt (mindestens Node aus `.nvmrc`/`.node-version`/`engines`, sonst global).
- **System Health raus:** CPU/RAM/Top-Prozesse (`components/SystemHealth.tsx`, `server/services/healthService.js`, `/api/system/health`) entfallen; die Tool-Versionen bleiben als eigener kleiner Baustein.
- **Sessions-Karte** an Stelle von System Health: Tabs **Neueste · Größte (Tokens) · Längste (Dauer)**, Daten aus den Session-Logs, die `server/services/usageService.js` ohnehin liest; Klick springt zur Session/zum Agent, wo möglich.
- **Limits reparieren:** Claude, MiniMax, Codex A, Codex B zeigen 5h- und Wochenlimit korrekt, soweit eine Quelle existiert. Hat der Plan kein 5h-Fenster (Claude Ultimate), erkennt das System das aus den Daten und blendet die 5h-Leiste aus statt „unbekannt" zu zeigen. Veraltete Werte werden mit Alter gekennzeichnet, nie als aktuell.
- **Zurück aus `/usage`:** sichtbarer Zurück-Knopf zur vorherigen Ansicht.
- **Agenten-Tabelle** statt „Open agents" in `components/AgentOverview.tsx`: alle Agents der Buckets (Running, Needs input, Working, Done, Cache expires, Compaction needed) als Tabelle mit Filter, Gruppierung (Status/Projekt), Aktionen Hinspringen, Stoppen, Neu starten (`respawn`), Löschen (`rm`), Umbenennen falls die CLI es kann; Aktionen über die bestehenden `/api/agents/*`-Routen.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`): Kontext Issue ↔ Agent ↔ Worktree ↔ PR. Modi gehören zum Kontext, also neben die Agents, nicht in die globale Titelleiste. System Health doppelt den Task-Manager; Hape braucht stattdessen, welche Sessions Tokens und Zeit fressen und ob er an ein Plan-Limit läuft. Heute zeigt die Limitanzeige für Claude nichts Brauchbares, das untergräbt das Vertrauen in die ganze Usage-Seite.

## Guardrails

- Basis `origin/main`, ein Feature-Branch, ein PR. Lokaler `main` hängt 25 Commits hinter origin.
- Agents-Panel, Terminals und Web-IDE bleiben gemountet (siehe Kommentar „Always mounted" in `App.tsx`), weil Modi sonst laufende Terminals verlieren.
- Bestehende Routen `/agents /board /code /workflows /usage /dashboard` bleiben gültig (Deep Links, Command Palette, Mobile-Header in `App.tsx`).
- Kein Anthropic-API-Key, kein API-Billing: Limits nur aus lokalen Quellen (Statusline-Snapshot `scripts/claude-rate-limits-tap.sh`, `~/.claude.json`, Codex-Rollouts) oder dem Endpoint, den Claude Code selbst mit dem Abo-Login nutzt. Zugangsdaten nie loggen oder an den Client geben.
- `~/.claude/settings.json` und andere Dateien außerhalb des Repos nicht ändern; braucht die Lösung dort etwas (z. B. Statusline-Tap), steht es in der Review-Anleitung als Schritt für Hape.
- Löschen/Stoppen von Agents nur nach Bestätigung im UI (kein `window.confirm`, eigener Dialog), weil `rm` nicht umkehrbar ist.
- Bestehende Muster: Popover/Dialoge aus `components/AgentsView/` und `components/CommandPalette/useDialogA11y`, Icons `lucide-react`, reine Logik in `utils/` mit Vitest-Test.
- Out of scope: Board-, Workflow-, Code-Modus inhaltlich; Landingpage; iOS-App-Layout über „bleibt bedienbar" hinaus.
- Höchstens 4 Subagenten parallel.

Befunde aus der Vorbereitung (Daten, Stand 2026-11-03):

- Claude: Statusline-Tap ist nicht installiert (`statusLine.command` = `awesome-statusline.sh`), `~/.claude/devorbit-rate-limits.json` fehlt; Fallback `~/.claude.json` `cachedUsageUtilization` ist vom 2026-10-09, also veraltet.
- Codex A: neuester Rollout hat `primary` (300 min, 0 %) und `secondary` (10080 min, 90 %) → die 5h-Leiste fehlt trotz Daten; Ursache im UI oder `rateWindow` suchen.
- Codex B: letzter Rollout in `~/.codex-b/sessions` vom 2026-09-24 → kein Snapshot im Fenster.
- MiniMax: Logs unter `~/.claude-minimax`; ob es überhaupt Plan-Limits gibt, klären und ehrlich anzeigen.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                                   | Nachweis                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Agents-Kopfzeile zeigt Roboter + 4 Modusschalter (Agents, Workflows, Board, Code); rechte `ViewToggles` sind weg; aktiver Modus markiert, Wechsel per Klick, Agents-Panel bleibt sichtbar                                                   | Vitest/RTL-Test der Modusleiste + Screenshots aller 4 Modi im PR                                                              |
| AC-2 | Roboter öffnet Kontext-Dashboard (nur Agents/Sessions der Projekte des aktiven Kontexts), Rakete öffnet globales Dashboard                                                                                                                  | Test der Filterlogik in `utils/` + Screenshots beider Dashboards mit unterschiedlichem Inhalt                                 |
| AC-3 | System Health (CPU/RAM/Prozesse) entfernt inkl. ungenutztem Server-Code; Tool-Versionen bleiben, im Kontext-Dashboard Node-Version je Projekt aus `.nvmrc`/`.node-version`/`engines`                                                        | Unit-Test des Versions-Resolvers; `grep -r SystemHealth` leer; Screenshot                                                     |
| AC-4 | Sessions-Karte mit Tabs Neueste / Größte (Tokens) / Längste (Dauer), Werte stimmen mit den Logs                                                                                                                                             | Unit-Test der Aggregation mit Fixture-Logs; Stichprobe gegen `scripts/verify-usage.mjs` oder eigenes Prüfskript               |
| AC-5 | Limits: Claude zeigt Woche (und 5h nur, wenn die Quelle ein 5h-Fenster liefert); Codex A zeigt 5h und Woche; Codex B und MiniMax zeigen Wert oder ehrlichen Grund („letzte Nutzung …", „kein Limit-Feed"); veraltete Werte tragen ihr Alter | Unit-Tests für `claudeLimits`/`codexLimits` (5h fehlt, 5h = 0 %, veraltet); `curl /api/usage?days=7` Auszug je Provider im PR |
| AC-6 | `/usage` hat Zurück-Knopf zur vorherigen Ansicht (Fallback Dashboard)                                                                                                                                                                       | RTL-Test + GIF Dashboard → Usage → zurück                                                                                     |
| AC-7 | Agenten-Tabelle mit Filter, Gruppierung, Aktionen Hinspringen/Stoppen/Neu starten/Löschen (mit Bestätigungsdialog) ersetzt „Open agents"                                                                                                    | Tests für Filter/Gruppierung in `utils/`; GIF einer Aktion; Netzwerk-Log zeigt passenden `/api/agents/*`-Aufruf               |
| AC-8 | Nichts kaputt: `bun run test:run`, `bun run lint`, `bun run build` grün                                                                                                                                                                     | Ausgabe im PR                                                                                                                 |

Stopp-Regel: weiterarbeiten bis alle AC belegt; nur bei fehlendem Zugang (z. B. Limit-Quelle nicht erreichbar) das AC als offen mit Grund melden. Rückmeldung: PR mit `## Nachweise`, kurzer Bericht, was angenommen wurde.

## Ambition

- Altitude: Issue bündelt 6 Themen; Alternative wäre Aufteilung in 3 PRs (Modusleiste+Dashboards, Usage/Limits, Agenten-Tabelle). Nur Vorschlag, Scope bleibt ein PR.
- Depth: Limits gegen echte lokale Quellen prüfen, nicht nur Fixtures; Ziel: Dashboard rendert < 1 s nach Navigation, Sessions-Aggregation nutzt den mtime-Cache von `usageService`.
- Crew: tut, was eine UX-Designerin tut (Modusleiste per Tastatur bedienbar, `aria-pressed`, Fokus sichtbar, Breite bei schmalem Fenster); tut, was ein Sicherheitsprüfer tut (OAuth-Token, falls genutzt, bleibt serverseitig; Lösch-Aktion nur mit Bestätigung).

## Prüfung

langlebig · unabhängig · Kernnavigation der täglichen Arbeitsumgebung plus irreversible Agent-Aktionen und ggf. Abo-Zugangsdaten.

## First on approval

`App.tsx` und `AgentsView`-Kopfzeile lesen, Modusleiste bauen und `ViewToggles` aus der `TitleBar` entfernen (AC-1), dann Screenshots als Ausgangslage.

## Annahmen

- Kontext-Dashboard = gleiche Bausteine wie global (Agenten-Tabelle, Usage-Karte, Sessions, Tool-Versionen), gefiltert auf den aktiven Kontext; Usage-Limits bleiben global, weil sie am Konto hängen (vorgeschlagen).
- Route fürs Kontext-Dashboard: `/dashboard?scope=context` o. ä., Entscheidung der Session (vorgeschlagen).
- Modusschalter wechseln nur, Agents ist der Standardmodus; Klick auf aktiven Modus tut nichts (vorgeschlagen).
- „Längste" = Wanduhr-Dauer erster bis letzter Logeintrag einer Session (vorgeschlagen).
- Claude-5h-Erkennung: Quelle liefert kein `five_hour` oder `null` → Plan ohne 5h-Fenster, Leiste ausblenden (vorgeschlagen).
- Fehlt eine frische Claude-Quelle, darf die Lösung den Endpoint nutzen, den Claude Code mit dem Abo-Login für `/usage` abfragt; sonst Statusline-Tap-Anleitung in der Review-Anleitung (vorgeschlagen).
- `ui: on` für den Board-Lauf, weil sichtbare UI und neue Journeys (vorgeschlagen).
