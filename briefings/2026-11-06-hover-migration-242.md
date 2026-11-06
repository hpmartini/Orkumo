# Briefing: Alte Hover-Einstellung nach #181 migrieren (#242)

## The Job
Bestandsnutzer, die den alten Default `hover` (#135) nur geerbt haben, beim nächsten Start auf das Klick-Verhalten aus #181 umstellen, ohne eine danach bewusst gewählte Einstellung je wieder anzufassen. Den Menüeintrag `Keep details open` nur dort zeigen, wo er etwas bewirkt: im Modus `hover`.

Konkret: Beim Laden der Settings wird ein gespeichertes `agentView.cardDetails = "hover"` ohne Migrationsmarke einmalig zu `click`; die Marke wird gesetzt und in `settings.json` persistiert. Mit Marke bleibt jeder Wert, auch `hover`.

## Why
Hape arbeitet täglich im Agents-Panel; auf seinem Rechner steht `cardDetails = hover` in `~/Library/Application Support/devorbit-dashboard/data/settings.json`, nie bewusst gewählt. #181 (PR #201) hat nur den Default geändert und wirkt deshalb nur bei frischen Installationen. Der Eintrag `Keep details open` ist in `click`/`always` überflüssig, weil der Klick die Details schon offen hält.

## Guardrails
- Migration im Server: `server/services/settingsService.js` (`readSettings` bzw. `getAgentViewSettings`), im Stil der vorhandenen Migrationen in `readSettings` (fehlende Keys auffüllen). Kein Migrations-Framework, weil es um eine einzige Marke geht.
- Nur `hover` ohne Marke wird migriert; `click` und `always` bleiben unverändert, weil sie nie Default waren oder schon der neue sind.
- Eine bewusst gewählte Einstellung nach der Migration bleibt dauerhaft, auch über Neustarts, weil sonst Hapes Wahl bei jedem Laden überschrieben würde.
- Menü: `components/AgentsView/AgentsView.tsx` um Zeile 1660 (`id: 'details'`).
- Bestehender Test `test/agentCardSettings.test.ts` (~Zeile 114, „a saved `hover` stays“) widerspricht der neuen Regel: anpassen, nicht löschen. Kommentar `components/AgentsView/AgentList.tsx:91` („pins them in every mode“) nachziehen.
- Out of scope: andere Settings migrieren, Settings-UI umbauen, Default ändern.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | `settings.json` mit `agentView.cardDetails: "hover"` ohne Marke → nach Laden liefert die Agent-View-Einstellung `click`, und die Datei enthält danach `click` plus Marke | Vitest gegen eine echte `settings.json` in einem Temp-Datenverzeichnis über den echten Lesepfad (Service bzw. `GET /api/settings/agent-view`), Datei danach neu einlesen |
| AC-2 | Mit Marke bleibt `hover` erhalten, auch über einen zweiten Ladevorgang (frischer Modul-Import / Neustart) | Vitest: zwei Ladevorgänge auf derselben Datei, beide `hover` |
| AC-3 | Nach der Migration `hover` bewusst wählen (`PUT /api/settings/agent-view` bzw. `updateAgentViewSettings`) → bleibt `hover` beim nächsten Laden | Vitest auf derselben Datei |
| AC-4 | `click` und `always` ohne Marke bleiben unverändert | Vitest |
| AC-5 | Kontextmenü einer Session-Karte im Modus `click` und `always` ohne `Keep details open`, im Modus `hover` mit | Komponententest (Testing Library) auf das gerenderte Menü |
| AC-6 | Bestehende Suite und Typecheck bleiben grün | `bunx vitest run` und `bunx tsc --noEmit` ohne neue Fehler, Ausgabe im PR |
| AC-7 | Sichtbarer Endzustand | Screenshot des Kontextmenüs im Modus `click` im PR unter `## Screenshots` |

## Ambition
- Altitude: keine; ein allgemeines Settings-Versionierungsschema wäre größer als der Auftrag und braucht eigene Freigabe.
- Depth: Migration idempotent und einmalig, belegt an einer echten Datei über zwei Ladevorgänge.
- Crew: übersprungen: einfache Aufgabe.

## Prüfung
wegwerf · selbst · einmalige Migration einer UI-Präferenz, Fehler kostet nur einen falschen Anzeige-Modus, in den Settings umstellbar.

## First on approval
`server/services/settingsService.js` und `test/agentCardSettings.test.ts` lesen und den roten Test für AC-1 schreiben.

## Annahmen
- Marke als eigener Key, z. B. `agentView.cardDetailsMigrated: true` statt globalem `version: 2`, weil `version` heute fest `1` ist und keine Migrationslogik daran hängt (vorgeschlagen)
- Die Migration schreibt die Datei sofort zurück, sonst griffe sie bei jedem Laden neu (vorgeschlagen)
- Neue Settings-Dateien (Erstinstallation) bekommen die Marke ebenfalls, damit ein später gewähltes `hover` nie migriert wird (vorgeschlagen)
- Ist eine Session im Modus `click`/`always` noch aus früherer Nutzung angepinnt (`expandedSessions`), bleibt `Hide details` sichtbar, damit sie lösbar ist; `Keep details open` erscheint dort nie (vorgeschlagen)
- `ui: on` für den Screenshot in AC-7 (vorgeschlagen)
