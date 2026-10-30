# Briefing: Quick-Filter „Cache läuft ab“ in der Agents-View

Quelle: Issue https://github.com/hpmartini/DevHub/issues/141 (Text von hpmartini, als Daten zitiert: „Neben Awaiting Input Working und Completed möchte ich einen vierten Quick Filter haben für Agents, deren Caches in 10 Minuten ablaufen. Inklusive Anzahl.“). Der Screenshot im Issue zeigt die Status-Leiste im Header der Agents-View (`AgentSummaryBar`).

## The Job

Hape in der Agents-View (`/agents`) auf einen Blick zeigen, wie viele Agents ihren Prompt-Cache in den nächsten 10 Minuten verlieren, und sie mit einem Klick herausfiltern. Konkret: ein vierter Toggle „N cache expiring“ neben „awaiting input“, „working“ und „completed“ im Header, derselbe Filter als Chip in der Filterleiste über der Liste und als Befehl in der Command-Palette. Zählung und Filter folgen der Zeit, ohne dass neue Daten vom Server kommen müssen.

## Why

Ein abgelaufener Prompt-Cache heißt: Der nächste Turn liest den ganzen Kontext neu ein, langsamer und teurer im Abo-Kontingent. Hape will diesen Agents rechtzeitig antworten. Die Liste markiert solche Agents schon einzeln (amber `CacheBadge`, amber Gruppenmarker); es fehlt die Sammelzahl und der Filter darauf.

## Guardrails

- Kriterium wiederverwenden: `isCacheWarning` / `CACHE_WARN_MS` aus `utils/agentCache.ts`, keine zweite Schwelle, damit Zähler und amber Markierung nie auseinanderlaufen.
- Filter-Modell erweitern, nicht umbauen: `AgentQuickFilter`, `QUICK_FILTERS`, `matchesQuickFilter`, `applyQuickFilters` in `utils/agentSessions.ts`; Darstellung in `components/AgentsView/AgentSummaryBar.tsx` (Header-Toggle und `AgentFilterBar`-Chip); Verdrahtung in `components/AgentsView/AgentsView.tsx` (`chipCounts`, `shownSessions`; die Palette-Schleife über `QUICK_FILTERS` greift dann automatisch).
- `matchesQuickFilter` bekommt die Zeit von außen (z. B. `now` im `SessionLookup`), damit die Funktion pur und testbar bleibt; den vorhandenen `now`-Takt der View nutzen statt eines zweiten Intervalls.
- Optik wie die übrigen Toggles; Ton bei N > 0 amber wie der `CacheBadge` (`text-amber-300`), grau bei 0.
- Out of scope: Benachrichtigungen, Sortierung nach Restzeit, Änderungen an `CacheBadge`, an der Cache-Berechnung im Server oder an `CACHE_WARN_MS`.

## Done means

| ID   | Bedingung                                                                                                                                                                     | Nachweis                                                                                                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | `matchesQuickFilter('cache-expiring', …)` trifft genau Agents mit warmem Cache und Restzeit ≤ 10 min; Restzeit > 10 min, abgelaufener Cache und fehlender Cache treffen nicht | Unit-Tests in `test/agentSessions.test.ts`, `bun run test:run` grün                                                                                    |
| AC-2 | Kombination mit einem Status-Filter wirkt als UND („working“ + „cache expiring“ = arbeitende Agents mit ablaufendem Cache)                                                    | Unit-Test zu `applyQuickFilters` in derselben Datei                                                                                                    |
| AC-3 | Header zeigt „N cache expiring“ rechts von „completed“; N = Zahl der amber markierten Agents; Klick setzt den Filter (`aria-pressed=true`), zweiter Klick hebt ihn auf        | Komponententest (Testing Library) für `AgentSummaryBar` oder Playwright-Prüfung gegen die laufende App; Screenshot der Leiste mit aktivem Filter im PR |
| AC-4 | Chip „Cache expiring“ mit Zähler in der Filterleiste und Palette-Befehl „Add filter: Cache expiring“ schalten denselben Filter                                                | Komponententest oder Playwright-Prüfung; Ausgabe im PR                                                                                                 |
| AC-5 | Läuft ein Cache ins 10-Minuten-Fenster oder ab, ändern sich Zähler und gefilterte Liste ohne Neuladen und ohne neue Serverdaten                                               | Test mit Fake-Timers (`vi.useFakeTimers`) über den Zeittakt, oder Playwright mit `page.clock`; Ausgabe im PR                                           |
| AC-6 | Bestehende Filter, Tests und Build bleiben unverändert grün                                                                                                                   | `bun run test:run`, `bun run lint`, `bun run build` grün, Ausgabe im PR                                                                                |

## Ambition

- Altitude: Statt nur zu filtern könnte die View ablaufende Caches aktiv melden (Badge im Tab-Titel, Notification) — nur als Vorschlag, eigene Freigabe nötig.
- Depth: Echte Cache-Daten aus `useAgentContexts` (`AgentCacheInfo`: `lastActivityAt`, `ttlMs`) in Tests als Fixture; Ziel: Zähler und amber Markierung stimmen in 100 % der Fälle überein, weil beide dieselbe Funktion nutzen.
- Crew: tut, was eine Accessibility-Prüferin tut: Toggle per Tastatur bedienbar, `aria-pressed` korrekt, Zähler nicht nur über Farbe unterscheidbar.

## Prüfung

langlebig · selbst · Kernansicht, die Hape täglich nutzt, aber reine UI-Logik ohne Vertrauensgrenze, Fremddaten oder externe Nutzer des Codes.

## First on approval

`AgentQuickFilter` in `utils/agentSessions.ts` um `cache-expiring` erweitern, Test zu AC-1 zuerst in `test/agentSessions.test.ts`.

## Annahmen

- Der neue Filter ist ein Attribut-Filter (UND mit Status-Filtern), weil er quer zu den Zuständen liegt; die drei vorhandenen Status-Toggles bleiben untereinander ODER. (vorgeschlagen)
- Abgelaufene Caches zählen nicht mit; „ablaufen in 10 Minuten“ heißt Restzeit > 0 und ≤ 10 min, wie `isCacheWarning`. (vorgeschlagen)
- Beschriftung englisch wie der Rest der Leiste: Header „cache expiring“, Chip „Cache expiring“, Tooltip „Agents whose prompt cache expires within 10 minutes“. (vorgeschlagen)
- Der Header-Toggle ist immer sichtbar, auch bei 0, wie „working“ und „completed“. (vorgeschlagen)
- Gezählt wird wie bei den anderen Chips über alle Sessions, unabhängig von anderen aktiven Filtern. (vorgeschlagen)
