# Briefing: Tiling wie Ghostty (Split-Baum) und Browser-Pane als eigener Tab (#212)

Issue: https://github.com/hpmartini/Orkumo/issues/212 · Screenshots: `briefings/assets/212/orkumo.png` (Ist), `briefings/assets/212/ghostty.png` (Soll)

## The Job

Der Agents-Workspace (`/agents`, Tabs mit Panes) teilt Panes wie Ghostty: Wer eine Pane auf den Rand einer anderen Pane zieht, teilt **nur diese Ziel-Pane**; alle anderen Panes behalten Position und Größe. Im Ist-Screenshot liegen zwei Terminals oben nebeneinander, der Browser wurde unter das linke gezogen, und das rechte Terminal endet trotzdem auf halber Höhe (2×2-Grid, rechts unten leer). Soll: das rechte Terminal geht über die volle Fensterhöhe, links stehen Terminal und Browser übereinander.

Zweitens: Eine Browser-Pane, die auf die Tab-Leiste gezogen wird, erscheint als eigener Tab (wie es Terminal-Panes heute schon tun) und bleibt nach Reload erhalten.

## Why

Hape arbeitet in Orkumo mit mehreren Agents plus Browser-Vorschau gleichzeitig. Das Raster verschenkt Platz und zwingt ihn, Layouts neu zu bauen; Ghostty ist sein Maßstab, weil er dort täglich so arbeitet. Danach soll Tiling sich ohne Nachdenken bedienen lassen: ziehen, wo es hin soll, und es landet genau dort.

## Guardrails

- Kern ist das Modell in `utils/agentWorkspace.ts`: `WorkspaceTab.panes: string[]` + `layout` reicht für verschachtelte Splits nicht. Ersetze das durch einen Split-Baum (Blatt = Pane-ID, Knoten = Richtung + Kinder), weil nur ein Baum „nur die Ziel-Pane teilen" ausdrücken kann. Funktionen bleiben rein und unit-getestet (`test/useAgentWorkspace.test.ts`, ggf. neue Testdatei).
- `migrateWorkspace` liest alte gespeicherte Workspaces (flaches `panes` + `layout`, und das Legacy-`openIds`) verlustfrei ein, weil Hapes offene Tabs sonst beim Update verschwinden.
- Rendering in `components/AgentsView/AgentWorkspace.tsx` bleibt bei `react-resizable-panels` (verschachtelte `Group`s); keine neue Dependency.
- Jede Pane bleibt beim Umbauen gemountet, soweit möglich, weil Terminals ihre WebSockets halten (Kommentar „every tab stays mounted"). Ein Remount einer verschobenen Pane ist ok, ein Remount unbeteiligter Panes nicht.
- Browser-Tab: Ursache ist der Filter `.filter((t) => t.sessions.some((s) => browserUrl(s.id) === null))` in `AgentWorkspace.tsx`, der Tabs nur mit Browser-Pane ausblendet. Er soll nur noch Tabs ausblenden, deren Panes noch nicht geladen sind. `pruneMissing` schont Browser-Panes schon.
- Out of scope: Tab-Reihenfolge, Chat-Pane-Inhalt, Board, Dashboard.

## Done means

| ID   | Bedingung                                                                                                                                                                                       | Nachweis                                                                                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Issue-Szenario: Tab mit A \| B nebeneinander, Pane C auf den unteren Rand von A gezogen → A und C links übereinander, B rechts über die **volle Höhe** des Tab-Bodys; kein leeres Rasterfeld    | Playwright gegen `bun run dev` `/agents`: echtes Drag&Drop, dann `getBoundingClientRect` von B: Höhe = Tab-Body-Höhe (±2 px), A.height + C.height ≈ B.height; Screenshot im PR |
| AC-2 | Drop auf eine Kante teilt nur die Ziel-Pane: alle vier Kanten (left/right/top/bottom) setzen die neue Pane auf die richtige Seite; Rects unbeteiligter Panes bleiben unverändert                | Unit-Tests auf dem Modell (`utils/agentWorkspace.ts`) je Kante + im Playwright-Lauf aus AC-1 Rect-Vergleich der unbeteiligten Pane vor/nach dem Drop                           |
| AC-3 | Schließen oder Detach einer Pane kollabiert ihren Elternknoten; die Geschwister-Pane füllt den frei gewordenen Platz, übrige Struktur bleibt                                                    | Unit-Tests (close, detach, letzte Pane schließt Tab)                                                                                                                           |
| AC-4 | Gespeicherte Workspaces im alten Format (flaches `panes` + `layout` columns/rows/grid, Legacy-`openIds`) laden verlustfrei: jede Pane bleibt im selben Tab, aktiver Tab und aktive Pane bleiben | Unit-Tests auf `migrateWorkspace` mit je einer Fixture pro Altformat + manueller Reload-Check: alten localStorage-Wert setzen, App neu laden, Tabs zählen                      |
| AC-5 | Browser-Pane auf die Tab-Leiste gezogen → eigener, aktiver Tab mit der Browser-Ansicht; nach Reload noch da                                                                                     | Playwright: Drag des Browser-Pane-Headers auf das leere Ende der Tab-Leiste, Tab sichtbar; `page.reload()`, Tab weiterhin sichtbar; GIF des Ablaufs im PR                      |
| AC-6 | Unbeteiligte Terminals remounten beim Split nicht (WebSocket bleibt offen)                                                                                                                      | Playwright: WebSocket-Frames/Verbindungen des unbeteiligten Terminals vor und nach dem Drop (`page.on('websocket')` zählt keine neue Verbindung für dessen Session)            |
| AC-7 | Layout-Buttons Columns/Rows/Grid ordnen alle Panes des Tabs flach neu (nebeneinander / übereinander / 2-spaltig ausgeglichen)                                                                   | Unit-Tests auf `setTabLayout`                                                                                                                                                  |
| AC-8 | Regressionen: Tab-Reorder, Pane in anderen Tab ziehen, „Split right/down"-Buttons, Schließen funktionieren wie vorher; Typecheck sauber                                                         | `bunx vitest run` komplett grün, `bunx tsc --noEmit` ohne Fehler, Ausgabe im PR                                                                                                |

Stopp nur bei: Altformat lässt sich nicht verlustfrei migrieren, oder `react-resizable-panels` kann verschachtelte Gruppen nicht ohne Remount unbeteiligter Panes. Dann berichten statt umgehen. Rückmeldung: kurzer Bericht, was getan, was angenommen, Screenshot-/GIF-Pfade.

## Ambition

- Altitude: keine; Ghostty-Tiling ist selbst das Ziel. Tastatur-Splits und Pane-Fokus per Pfeiltaste wären der nächste Schritt (eigenes Issue).
- Depth: Ghostty/tmux-Modell (binärer Split-Baum, Ratio je Knoten), Playwright-Rect-Messung statt Augenmaß; Ziel 0 Remounts unbeteiligter Panes.
- Crew: tut, was ein QA-Tester tut: Drag-Kanten an schmalen Fenstern (< 2×400 px) und mit 4+ Panes durchprobieren; tut, was ein Datenmigrations-Prüfer tut: echten localStorage-Wert aus Hapes App als Fixture nehmen.

## Prüfung

langlebig · unabhängig · Kern-Layout des Agents-Modus mit Migration persistierter Nutzerdaten, viel genutzt.

## First on approval

Split-Baum-Typ und `splitInto`/`removeSession` in `utils/agentWorkspace.ts` test-first gegen das Issue-Szenario schreiben.

## Annahmen

- Die Layout-Buttons (Columns/Rows/Grid) in der Tab-Leiste bleiben und bauen den Baum des Tabs flach neu auf (alle nebeneinander / übereinander / 2-spaltig ausgeglichen). Nach einem manuellen Drag gilt keiner als aktiv. (vorgeschlagen)
- Die Schmal-Rückfalllogik (`MIN_PANE_PX`) bleibt sinngemäß: ein waagerechter Split, dessen Kinder zu schmal würden, wird gestapelt gerendert, ohne den gespeicherten Baum zu ändern. (vorgeschlagen)
- Panelgrößen müssen nicht über Reload persistiert werden (heute auch nicht); nach einem Split teilen sich die beiden neuen Hälften die Ziel-Pane 50/50. (vorgeschlagen)
- Tastatur-Splits, Fokus-Navigation zwischen Panes und Code-Mode-Tiling sind out of scope. (vorgeschlagen)
- `ui: on`: Screenshots und GIF im PR sind Pflicht (vorgeschlagen)
