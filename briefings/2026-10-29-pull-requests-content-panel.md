# Briefing: Offene Pull Requests als Vollansicht im Content-Panel (#157)

Quelle: https://github.com/hpmartini/DevHub/issues/157 (Screenshot dort: Popover „Open pull requests" über dem Agent-Terminal).

## The Job

Hape 20+ offene PRs in voller Breite durchgehen lassen und jede PR-Seite direkt daneben lesen lassen, ohne DevOrbit zu verlassen. Konkret: Das Popover „Open pull requests" (`components/AgentsView/PullRequestsPanel.tsx`, geöffnet aus `AgentSummaryBar` über `panel === 'prs'` in `AgentsView.tsx`) bekommt im Kopf neben dem Schließen-X einen Maximieren-Button (lucide `Maximize2`, zwei diagonal nach außen zeigende Pfeile). Klick schließt das Popover und öffnet dieselbe PR-Liste als eigene Ansicht im Content-Panel, so wie Dashboard und Workflow-View dort liegen (Children von `AgentsView` in `App.tsx`, eigene Route, eigener `ActiveTab`). Ein Klick auf einen PR-Link öffnet die PR-Seite in einem Split-Pane rechts neben der Liste; ein Klick auf einen anderen PR ersetzt die Seite im selben Pane. Das Pane lässt sich schließen; die Liste nimmt dann wieder die ganze Breite ein.

## Why

DevOrbit ist Hapes ADE (`docs/VISION.md`): Issue ↔ Agent ↔ Branch ↔ PR ↔ Code in einer Shell. Das Popover deckt das Terminal ab und schickt jeden PR-Link in den externen Browser. Hape will CI-/Merge-Status aller PRs sehen und die PR-Seite daneben lesen; danach soll Review und Abarbeiten von PRs in DevOrbit selbst passieren.

## Guardrails

- Liste nicht duplizieren: Zeilen-Rendering aus `PullRequestsPanel` teilen (eigene Komponente oder `variant`-Prop), weil Popover und Vollansicht dieselben Daten (`PullRequestRow`, `repoFilter`, Agent- und Code-Buttons) zeigen. Datenquelle bleibt die bestehende in `AgentsView`; kein neuer Server-Endpoint, die PR-Daten sind schon da.
- Split mit `react-resizable-panels` (`Group/Panel/Separator`) wie in `AgentWorkspace.tsx`; PR-Seite über `BrowserPreviewPanel url=… appId=""` wie `BrowserPane` dort, weil das Electron-`BrowserView` externe URLs seit 79b7cff erlaubt.
- Route `/pulls`, eingebunden wie `/workflows` (`ActiveTab`, `isXRoute`, Child-Container in `App.tsx`); Command-Palette-Eintrag neben `panel.prs` in `AgentsView`.
- `ExternalLink`-Icon bleibt separat und öffnet weiter im System-Browser, damit der bisherige Weg erhalten bleibt.
- Popover-Verhalten (`usePopover`: Esc, Outside-Click, Fokus-Rückgabe) bleibt unverändert.
- Out of scope: PR-Aktionen (Merge, Review schreiben), neue PR-Daten, `ServersPanel`.
- Subagenten: höchstens 2 (kleiner Auftrag).

## Done means

| ID   | Bedingung                                                                                                                           | Nachweis                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Popover zeigt Maximieren-Button (`Maximize2`, `aria-label`, `title`); Klick navigiert zu `/pulls` und schließt das Popover          | Vitest: Button per Rolle/Label finden, Klick → Navigations-Callback aufgerufen, `onClose` aufgerufen                                                |
| AC-2 | `/pulls` rendert die PR-Liste im Content-Panel (gleiche Zeilen, Repo-Filter, Agent-/Code-Buttons) wie Dashboard/Workflows           | Vitest-Render der Vollansicht mit Fixture-Rows; Screenshot der Route                                                                                |
| AC-3 | PR-Klick in der Vollansicht öffnet rechts genau ein Pane mit der PR-URL; zweiter PR-Klick ersetzt die URL, weiterhin genau ein Pane | Vitest: zwei Klicks → ein Pane, URL = zweiter PR                                                                                                    |
| AC-4 | Schließen des Panes entfernt es, Liste wieder volle Breite                                                                          | Vitest: Close-Klick → kein Pane                                                                                                                     |
| AC-5 | Ohne Electron (Web-Modus) öffnet PR-Klick einen neuen Browser-Tab statt eines leeren Panes                                          | Vitest mit `window.electronAPI` undefined: `window.open` gespiegelt, kein Pane                                                                      |
| AC-6 | Popover, `/agents`, `/workflows`, Dashboard unverändert; Build, Lint, alle Tests grün                                               | `bun run build`, Lint, `bun run test` (bzw. Projekt-Testbefehl) Ausgabe im PR                                                                       |
| AC-7 | Vollansicht mit offenem Split-Pane im echten App-Lauf sichtbar                                                                      | Screenshot (Electron oder Playwright) im PR; in Playwright/Web zeigt er AC-5-Verhalten, Electron-Screenshot nur wenn lauffähig, sonst `offen, weil` |

Stopp nur bei: Electron-`BrowserView` lässt sich nicht neben der Liste platzieren (Bounds/Overlay-Konflikt) → berichten. Rückmeldung: kurzer Bericht, was gebaut, was angenommen, Nachweis je AC.

## Ambition

- Altitude: PR-Seite direkt im Agent-Workspace als `BrowserPane` neben dem Agent-Terminal öffnen (verbindet PR ↔ Agent); nur Vorschlag, eigene Freigabe.
- Depth: bestehende Muster (`AgentWorkspace`, `/workflows`-Einbindung) wiederverwenden; Ziel: kein zweiter PR-Datenpfad, Pane-Wechsel ohne Neuaufbau des BrowserView.
- Crew: tut, was eine A11y-Prüferin tut: Maximieren-Button und PR-Links per Tastatur erreichbar, Fokus nach Navigation sinnvoll.

## Prüfung

langlebig · unabhängig · dauerhaftes UI-Feature der Shell, Route und geteilte Komponente werden von mehreren Modi genutzt.

## First on approval

`PullRequestsPanel.tsx` und die Einbindung von `/workflows` in `App.tsx` lesen und entscheiden, wie die PR-Liste zwischen Popover und Vollansicht geteilt wird.

## Annahmen

- Im Web-Modus blockt GitHub iframes (`X-Frame-Options: deny`), daher dort Fallback neuer Tab statt Pane (vorgeschlagen).
- Pane-Breite und zuletzt offener PR werden nicht persistiert (vorgeschlagen).
- Mobile (`md:hidden`): Vollansicht nur Liste, PR-Klick öffnet extern (vorgeschlagen).
- Route heißt `/pulls` (vorgeschlagen).
