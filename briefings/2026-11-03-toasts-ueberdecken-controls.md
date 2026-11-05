# Briefing: Toasts überdecken keine Controls mehr

Quelle: Issue https://github.com/hpmartini/DevHub/issues/183 (Text von hpmartini; Screenshot zeigt einen Toast rechts oben über den Header-Controls).

## The Job

Toasts informieren Hape, ohne ihm die Bedienung zu nehmen: Fährt die Maus über einen Toast, wird er fast durchsichtig und Klicks gehen an das Control darunter (Preview-Browser schließen, die Modus-Icons Workflow/Board/Code rechts oben, Agent-Controls). Jeder Toast lässt sich zusätzlich per Klick auf ein kleines `×` sofort schließen. Toasts mit Aktion („Rückgängig“ in `components/BoardView/useBoard.tsx`, „Zum Board“ in `components/AgentsView/AgentsView.tsx` ~2187) behalten eine bedienbare Aktion.

## Why

Hape arbeitet in DevOrbit mit vielen parallelen Agents; Toasts kommen häufig und stehen bis zu 8 s (`toast.error` mit `duration: 8000`). In der Zeit sind genau die Controls rechts oben blockiert, die er am meisten braucht. Ziel: Benachrichtigung bleibt sichtbar, blockiert aber nie einen Klick.

## Guardrails

- Zentrale Lösung am `<Toaster>` in `App.tsx` (~234, `react-hot-toast` ^2.6), nicht an den ~39 Aufrufstellen, damit neue Toasts automatisch mitziehen. Ein eigener Render über `toastOptions`/`Toaster`-Children oder `useToaster` ist erlaubt, kein neues Paket, weil react-hot-toast das abdeckt.
- Durchklicken braucht Hover-Erkennung, obwohl der Toast `pointer-events: none` hat; also Zeigerposition gegen die Toast-Rechtecke prüfen (z.B. `pointermove` auf `document`), nicht CSS-`:hover`. Die Entscheidungslogik (Zeiger über Toast? über Aktions-Button?) als reine, unit-getestete Funktion in `utils/`.
- Aktions-Buttons und `×` bleiben klickbar: dort keine Durchsichtigkeit/kein Durchreichen, sonst sind Undo und Schließen unerreichbar.
- Position (`top-right`), Farben, Dauer und Inhalte der Toasts bleiben, weil nur das Blockieren das Problem ist.
- Tastatur/Screenreader: `×` ist ein `<button>` mit `aria-label`, Toast-Rolle (`status`/`alert`) bleibt erhalten.
- Out of scope: Wischgesten, Toast-Historie, Umstellung auf andere Library, native Electron-`BrowserView` (liegt ohnehin über dem DOM).
- Tests unter `test/` mit vitest; Muster für den Toast-Mock in `test/useBoard.test.tsx`.

## Done means

| ID   | Bedingung                                                                                                                      | Nachweis                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Zeiger über Toast-Fläche (außer Buttons) → Toast wird durchsichtig (Opacity ≤ 0.2) und ein Klick erreicht das Element darunter | Unit-Test der Hit-Logik in `utils/`; Komponententest: Klick an Toast-Position löst Handler eines darunterliegenden Buttons aus; GIF im PR (Toast offen, Modus-Icon rechts oben klicken) |
| AC-2 | Zeiger verlässt Toast → volle Deckkraft zurück                                                                                 | Komponententest (Opacity-Zustand nach `pointermove` außerhalb)                                                                                                                          |
| AC-3 | Jeder Toast hat ein `×`, Klick schließt ihn sofort                                                                             | Komponententest: `toast.dismiss` mit ID bzw. Toast aus DOM; Screenshot im PR                                                                                                            |
| AC-4 | Aktions-Buttons („Rückgängig“, „Zum Board“) bleiben über dem Toast klickbar und lösen ihre Aktion aus                          | Komponententest mit Undo-Toast aus `useBoard`; bestehender `test/useBoard.test.tsx` grün                                                                                                |
| AC-5 | Position, Farben, Dauer, success/error-Icons unverändert                                                                       | Screenshot-Vergleich vorher/nachher im PR (`## Screenshots`)                                                                                                                            |
| AC-6 | Gesamtstand sauber                                                                                                             | `bunx vitest run` grün, `bunx tsc --noEmit` ohne neue Fehler, Ausgabe im PR                                                                                                             |

Stopp nur, wenn react-hot-toast ein zentrales Custom-Rendering in 2.6 nicht zulässt: dann mit Befund melden statt die 39 Aufrufstellen umzubauen. Rückmeldung: kurzer Bericht, was gebaut, was angenommen, was offen.

## Ambition

- Altitude: Toasts für Agent-Ereignisse könnten statt Overlay in die Agent-Rail/Statusleiste wandern; nur Vorschlag, nicht Scope.
- Depth: Durchreichen ohne Ruckeln (`pointermove` throttled per `requestAnimationFrame`), Übergang ≤ 150 ms.
- Crew: tut, was ein a11y-Prüfer tut: `×` per Tab erreichbar und per Enter auslösbar, Fokus springt beim Schließen nicht ins Leere.

## Prüfung

wegwerf · selbst · kleine, rein lokale UI-Änderung ohne Vertrauensgrenze, leicht rückbaubar.

## First on approval

`<Toaster>` in `App.tsx` und die zwei Aktions-Toasts lesen, dann die Hit-Logik als reine Funktion samt Test in `utils/` anlegen.

## Annahmen

- Beide Wünsche aus dem Issue werden kombiniert: durchsichtig + durchklickbar bei Hover **und** `×` zum Schließen; Wegwischen entfällt (vorgeschlagen).
- Über Aktions-Buttons wird nicht durchgereicht, damit Undo erreichbar bleibt (vorgeschlagen).
- Position bleibt `top-right`; ein Umzug nach unten wäre einfacher, verschiebt das Problem aber nur auf andere Controls (vorgeschlagen).
- `ui: on` für diesen Lauf, da sichtbare UI und Interaktion sich ändern (vorgeschlagen).
