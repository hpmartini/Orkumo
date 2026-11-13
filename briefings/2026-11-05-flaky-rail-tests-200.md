# Briefing: Flaky Rail-Tests stabilisieren (#200)

## The Job

Den Hänger finden, der `test/agentsViewRail.test.tsx` und `test/railModes.test.tsx` unter Last in `Test timed out in 5000ms` laufen lässt (Gruppierung `state`, #50, Tastatur- und Drag-and-drop-Pfade), ihn an der Wurzel beheben – im Test-Setup oder, falls es ein echter Race ist, im Rail-Code – und belegen, dass beide Dateien unter Last deterministisch 23/23 grün laufen, ohne dass der Volllauf andere Dateien mitreißt.

## Why

Hape lässt viele Agent-Läufe parallel auf Orkumo arbeiten; jeder PR fährt die volle Suite. Rot ohne Bezug zum Diff (zuletzt bei #182 / PR #199) kostet Review-Zeit und lehrt, rote Läufe zu ignorieren. Ziel dahinter: Rot in der Suite bedeutet wieder etwas.

Befund (Issue-Daten, nicht nachgeprüft): auf `ba06aac` ergaben drei Läufe von `bunx vitest run test/agentsViewRail.test.tsx test/railModes.test.tsx` 10, 2 und 0 von 23 Tests rot, alle `Test timed out in 5000ms`. Eigene Messung auf `af96249` ohne Last: 2× 23/23 grün, Einzeltests 30–420 ms. Ein Test, der normal < 0,5 s braucht und dann 5 s reißt, ist nicht langsam, sondern hängt: er wartet auf etwas, das unter Last nie oder in anderer Reihenfolge eintritt (`findBy*`/`waitFor`, Timer, Event-Reihenfolge, Zustand zwischen Tests wie `localStorage` oder `hoisted.grouping`).

## Guardrails

- Scope: die zwei Testdateien, `test/setup.ts`, ggf. Rail-Code unter `components/AgentsView/` und `hooks/useRailPreferences.ts`. Weitere Flakes im Volllauf nur anfassen, wenn dieselbe Ursache greift; sonst neues Issue (`mw board add`), damit dieser PR klein bleibt.
- `testTimeout` bleibt bei 5000 ms, keine `retry`-Option, kein `.skip`/`.todo`: das verdeckt den Hänger, statt ihn zu beheben.
- Testabsicht (AC-1 bis AC-5 von #50, Tastatur, DnD, Status-Edge-Cases) bleibt; Assertions werden nicht abgeschwächt oder entfernt, weil sie das Rail-Verhalten absichern.
- Vitest-/jsdom-Konfiguration (`vitest.config.ts`) nur ändern, wenn die Ursache dort liegt, mit Begründung im PR, weil sie alle Tests betrifft.

## Done means

| ID   | Bedingung                                                                                                                           | Nachweis                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Ursache ist benannt: Datei:Zeile und Mechanismus, warum der Test unter Last > 5000 ms hängt                                         | Abschnitt „Ursache" im PR; Repro auf `origin/main` mit dem Stressskript aus AC-2 zeigt ≥ 1 Timeout (Zahl im PR)                                                                           |
| AC-2 | Beide Dateien laufen unter Last 20 Durchgänge mit 0 von 23 Tests rot                                                                | Committetes Skript `scripts/review/200.sh`: 20 Durchgänge, je 4 parallele `bunx vitest run test/agentsViewRail.test.tsx test/railModes.test.tsx`; Exit 0 nur bei 0 Fehlern; Ausgabe im PR |
| AC-3 | Kein Ausweichen: `testTimeout` 5000 ms unverändert, kein `retry`, kein `.skip`/`.todo`, Anzahl Tests in beiden Dateien weiterhin 23 | `git diff origin/main` im PR zeigt keine solche Änderung; Testzahl aus Vitest-Ausgabe                                                                                                     |
| AC-4 | Volle Suite und Typecheck grün                                                                                                      | `bunx vitest run` und `bunx tsc --noEmit` Exit 0, Ausgabe-Zusammenfassung im PR                                                                                                           |

## Ambition

- Altitude: Globaler Flake-Wächter für die ganze Suite (Stresslauf in CI) würde künftige Flakes früh zeigen – nur Vorschlag, eigene Freigabe.
- Depth: Vitest `--reporter=verbose`, `--sequence.shuffle`, CPU-Last durch parallele Prozesse; bei Hänger `screen.debug()` bzw. Event-Log, um die wartende Zeile zu sehen. Ziel: 0 Fehler in 20 Durchgängen unter Last.
- Crew: keine

## Prüfung

langlebig · selbst · Test-Infrastruktur ohne Vertrauensgrenze; Nachweis ist ein deterministisches Stressskript.

## First on approval

Worktree von `origin/main`, Stressskript bauen und die Timeouts reproduzieren, mit `--reporter=verbose`, um zu sehen, an welcher Zeile der hängende Test wartet.

## Annahmen

- „Unter Last" lässt sich lokal mit 4 parallelen Vitest-Prozessen nachstellen; reproduziert das nicht, wird die Parallelität erhöht, bis Timeouts auftreten, und die verwendete Zahl im PR genannt (vorgeschlagen)
- Liegt die Ursache im Rail-Code (echter Race), wird sie dort behoben statt im Test umschifft (vorgeschlagen)
- Andere Flakes im Volllauf mit anderer Ursache kommen in eigene Issues (vorgeschlagen)
