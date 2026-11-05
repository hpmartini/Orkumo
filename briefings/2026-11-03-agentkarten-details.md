# Briefing: Agent-Karten klappen Details konsistent aus (#181)

## The Job

In der Agent-Liste (`/agents`, linke Spalte) zeigt immer höchstens eine Karte ihre Details vorübergehend an, und welche das ist, folgt einer Regel, die Hape in den Settings wählt: **Hover** (die Karte unter dem Zeiger klappt aus, ein Mausklick klappt nichts dauerhaft aus) oder **Klick** (die angeklickte bzw. ausgewählte Karte klappt aus, Hover klappt nichts aus). „Always“ und „Keep details open“ (Kontextmenü) bleiben wie heute. Neuer Standard ist **Klick**.

## Why

Hape steuert seine Agents aus dieser Liste. Heute (Modus `hover`) bleibt die ausgewählte Karte ausgeklappt (`focused` in `cardDetailsVisible`), und hovert er eine Karte darüber, liegt deren Overlay unter dem Overlay der ausgewählten Karte (beide `z-20`, die spätere im DOM gewinnt) – die gehoverte Karte scheint nicht auszuklappen. Zwei Auslöser gleichzeitig erzeugen dieses Durcheinander; ein Modus mit genau einem Auslöser macht das Verhalten vorhersagbar.

## Guardrails

- Setting existiert schon: `AgentCardDetails = 'hover' | 'click' | 'always'` (`types.ts`), Default in `types.ts` und `server/services/settingsService.js`, Schema `server/schemas/agentViewSettings.js`, Auswahl in `components/AgentsView/AgentSettingsPanel.tsx`. Werte beibehalten, nur ihre Bedeutung schärfen, weil gespeicherte Settings sonst ungültig würden.
- Regel in der reinen Funktion `cardDetailsVisible` (`utils/agentSessions.ts`) entscheiden, Rendering in `components/AgentsView/AgentList.tsx` nur anpassen; Tests in `test/agentCardSettings.test.ts`, `test/AgentList.test.tsx` folgen dem bestehenden Muster.
- Tastatur bleibt bedienbar: Im Klick-Modus klappt die per Pfeiltaste ausgewählte Karte aus; im Hover-Modus darf Tastaturauswahl ausklappen, aber nie zusätzlich zu einer gehoverten Karte.
- Touch-Geräte (`(hover: none)`) verhalten sich wie Klick, wie heute schon durch den `matchMedia`-Check angelegt.
- Out of scope: Kartenlayout, Felder, Overlay-Optik, andere Panels.

## Done means

| ID   | Bedingung                                                                                                                                                               | Nachweis                                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| AC-1 | Modus Hover: nach Klick auf Karte A und Hover über Karte B (oberhalb oder unterhalb von A) ist nur B ausgeklappt, A nicht                                               | Komponententest in `test/AgentList.test.tsx` (fake timers, mouseEnter) |
| AC-2 | Modus Klick: Hover klappt keine Karte aus; Klick oder Pfeiltasten-Auswahl klappt genau die ausgewählte Karte aus                                                        | Komponententest + Unit-Test `cardDetailsVisible`                       |
| AC-3 | In Hover und Klick ist nie mehr als eine Karte vorübergehend (ohne „Keep details open“) ausgeklappt                                                                     | Unit-Tests `cardDetailsVisible` über alle Zustandskombinationen        |
| AC-4 | Settings zeigen zwei klar benannte Optionen „Bei Hover“/„Bei Klick“ (plus „Always“); neuer Default `click` in Client und Server, alte gespeicherte Werte bleiben gültig | `test/agentCardSettings.test.ts` (Default, Schema)                     |
| AC-5 | Sichtprüfung beider Modi in der laufenden App                                                                                                                           | Screenshots je Modus im PR unter `## Screenshots`                      |
| AC-6 | Bestehende Suite und Build grün                                                                                                                                         | `bun run test` (bzw. vitest) und `bun run build`, Ausgabe im PR        |

Stopp-Regel: durcharbeiten bis alle ACs belegt; nur stoppen, wenn die App für AC-5 nicht startbar ist (dann AC-5 offen mit Grund). Rückmeldung: PR mit `## Nachweise` je AC.

## Ambition

- Altitude: keine (kleiner UI-Fix).
- Depth: übersprungen: einfache Aufgabe.
- Crew: einmal Tastatur-only durchklicken wie ein A11y-Prüfer (Pfeiltasten, Fokus, `aria-expanded` falls vorhanden).

## Prüfung

wegwerf · selbst · lokale UI-Logik ohne Vertrauensgrenze, durch Tests abgesichert.

## First on approval

Worktree von `origin/main` anlegen und den Fehler aus AC-1 als roten Test in `test/AgentList.test.tsx` nachstellen.

## Annahmen

- Default wechselt von `hover` auf `click`, weil Hape im Issue Klick favorisiert; wer `hover` gespeichert hat, behält es (vorgeschlagen).
- Klick auf die bereits ausgeklappte, ausgewählte Karte klappt sie nicht zu; zuklappen durch Auswahl einer anderen Karte oder Fokus raus aus der Liste (vorgeschlagen).
- Im Klick-Modus zählt die Auswahl nur, solange die Liste den Fokus hat (`railFocused`), wie heute; sonst würde ein Overlay dauerhaft über den Karten liegen (vorgeschlagen).
- Option „click“ meinte bisher „nur per Keep details open“; diese Bedeutung entfällt, „Keep details open“ wirkt weiter in allen Modi (vorgeschlagen).
- `ui: on` für das Issue, da sichtbares UI-Verhalten (vorgeschlagen).
