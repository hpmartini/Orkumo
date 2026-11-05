# Briefing: Browser vereinheitlichen – alle Controls in einer Leiste

Quelle: Issue https://github.com/hpmartini/DevHub/issues/185 (Text von hpmartini, zwei Screenshots: Browser aus Terminal/Agent-Pane mit zusätzlicher Titelleiste „Globe + URL + Maximize + X“, Browser aus der UI mit drei Leisten „Browser Preview“-Titel, URL-Zeile, Viewport-Zeile).

## The Job

Den eingebauten Browser überall mit **einer** Werkzeugleiste bedienen: Refresh, URL-Feld, Viewport-Wahl (Desktop/Tablet/Mobile als Icon-Schalter), DevTools, „im Systembrowser öffnen“ und Schließen stehen in derselben Zeile; der Rest der Höhe gehört der Seite. Das gilt für alle drei Einstiege, die heute `BrowserPreviewPanel` rendern: Shell-Browser rechts (`components/ShellBrowser.tsx`), Browser-Pane in Agent-Tabs (`BrowserPane` in `components/AgentsView/AgentWorkspace.tsx`) und PR-Seite (`PullRequestsPage.tsx`, nutzt `BrowserPane`). Die eigene Titelleiste von `BrowserPane` entfällt; ihre Funktionen (Maximize „Own tab“, Close, Drag-Griff bei mehreren Panes, aktiver Rahmen) wandern in die eine Leiste. Beide Varianten – Electron (`ElectronBrowserView.tsx`) und iframe (`BrowserPreviewPanel.tsx`) – bekommen dieselbe Leiste.

## Why

Hape arbeitet agentisch mit mehreren Panes nebeneinander; jede Leiste kostet vertikalen Platz in genau dem Fenster, in dem er die laufende App prüft. Drei bis vier Leisten für eine Browser-Ansicht sind Rauschen, die doppelte Titelleiste aus dem Terminal-Weg wirkt wie ein Bug. Ziel: ein Browser, der aussieht und sich bedient wie ein Browser-Tab, egal woher er geöffnet wurde.

## Guardrails

- Eine gemeinsame Leisten-Komponente für Electron- und iframe-Variante statt zweier Kopien, weil beide heute fast identischen Header-Code duplizieren und #182 dieselbe Leiste erweitert.
- Pane-Drag (`headerProps` mit `dragProps`) und Maximize bleiben funktionsgleich; die Leiste nimmt sie optional entgegen, z. B. als zusätzliche Aktionen bzw. Props. Der Drag-Griff darf URL-Feld und Buttons nicht blockieren.
- Bestehende Accessible Names bleiben, weil Tests sie nutzen: `Close browser` (Pane, `test/pullRequestsView.test.tsx`), `Hide browser preview`, `Move browser to its own tab`. Gibt es in einem Kontext nur noch einen Schließen-Button, trägt er den Namen, den der bisherige Test erwartet.
- `ElectronBrowserView` misst die native View per `ResizeObserver` am Container; die Leiste muss danach weiter korrekt sitzen (keine Überdeckung durch die native View).
- Funktionen nicht ändern: URL-Validierung, Viewport-Breiten, DevTools-Logik, Logger-Injection, IPC in `electron/`.
- Out of scope: Vor/Zurück-Buttons, Maus-Seitentasten, Cmd+R-Routing, `X`-Icon-Tausch in der Electron-Variante – das ist Issue #182 (Briefing `briefings/2026-11-03-preview-browser-controls.md`, Status mw:go). Die Leiste lässt links neben Refresh Platz für Vor/Zurück. Ebenfalls out of scope: der leere Zustand „Application not running“.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                         | Nachweis                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Electron- und iframe-Variante zeigen genau eine Leiste mit Refresh, URL-Feld, Viewport-Schaltern, DevTools, Systembrowser-Link und (wenn `onHide` gesetzt) Schließen; kein „Browser Preview“-Titel, keine separate Viewport-Zeile | Komponententest (`test/electronBrowserView.test.tsx` + neuer Test für iframe-Variante): alle Controls in einem `role="toolbar"`, Titeltext fehlt; Screenshot beider Varianten im PR |
| AC-2 | `BrowserPane` (Agent-Tab, PR-Seite) hat keine eigene Titelleiste mehr; Maximize und Close sitzen in der einen Leiste, genau ein Schließen-Button                                                                                  | Komponententest: ein Button `Close browser`, kein zweiter Close; `test/pullRequestsView.test.tsx` grün; Screenshot Agent-Pane im PR                                                 |
| AC-3 | Viewport-Wechsel, DevTools-Toggle, Refresh, URL-Enter, Maximize und Close funktionieren wie vorher                                                                                                                                | Bestehende und ergänzte Komponententests (Klick → Callback/API-Aufruf)                                                                                                              |
| AC-4 | Bei zwei Panes im Tab lässt sich der Browser-Pane weiter per Drag verschieben; Klick ins URL-Feld startet keinen Drag                                                                                                             | Komponententest: Drag-Props hängen am Griff, nicht am Input; GIF im PR aus `bun run electron:dev`                                                                                   |
| AC-5 | Die native Electron-View überdeckt die Leiste nicht und füllt den Rest bis unten                                                                                                                                                  | Screenshot im PR aus `bun run electron:dev` (Shell-Browser und Agent-Pane)                                                                                                          |
| AC-6 | Gesamtstand sauber                                                                                                                                                                                                                | `bunx vitest run` grün, `bunx tsc --noEmit` ohne neue Fehler, Ausgabe im PR                                                                                                         |

Stopp nur bei Konflikt mit einem inzwischen gemergten #182: dann auf dessen Stand rebasen und Vor/Zurück in die Leiste übernehmen. Rückmeldung: kurzer Bericht, was gebaut, was angenommen, was offen.

## Ambition

- Altitude: keine; UI-Bereinigung.
- Depth: Referenz ist die Chrome-/Arc-Toolbar; Ziel: Browser-Chrome ≤ 40 px Höhe statt heute ~3 Leisten (~120 px) bzw. 4 im Pane.
- Crew: tut, was ein Accessibility-Prüfer tut: Icon-only-Viewport-Schalter mit `aria-label` und `aria-pressed`, Tastaturbedienung der Leiste in Tab-Reihenfolge.

## Prüfung

langlebig · selbst · reine UI-Umordnung ohne Vertrauensgrenze, aber zentrale, oft genutzte Komponente in drei Modi.

## First on approval

Gemeinsame Leisten-Komponente aus dem Header- und URL-Bar-Code von `ElectronBrowserView.tsx` und `BrowserPreviewPanel.tsx` ziehen und zuerst in der Electron-Variante einsetzen.

## Annahmen

- Viewport-Schalter werden Icon-only (Monitor/Tablet/Smartphone) mit Tooltip, damit alles in eine Zeile passt. (vorgeschlagen)
- Die iframe-Variante (Web-Modus) wird mit vereinheitlicht, obwohl die Screenshots nur Electron zeigen, weil sie dieselbe Komponentenfamilie ist. (vorgeschlagen)
- Bei schmalen Panes (< ~360 px) darf das URL-Feld schrumpfen; Buttons bleiben sichtbar, kein Umbruch in eine zweite Zeile. (vorgeschlagen)
- Konflikt mit #182 (gleiche Dateien): wer zuerst gemergt wird, gewinnt, der andere rebased; #185 implementiert Vor/Zurück nicht selbst. (vorgeschlagen)
- `ui: on` für den Build, weil sichtbare UI geändert wird. (vorgeschlagen)
