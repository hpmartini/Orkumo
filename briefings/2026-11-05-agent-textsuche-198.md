# Briefing: Textsuche in der Filterzeile der Agents-Rail (#198)

## The Job
In der Filterzeile über der Agent-Liste (`AgentFilterBar` in `components/AgentsView/AgentSummaryBar.tsx`: Sortierung, Richtung, Chips-Toggle, PR/Issue-Filter, „N agents“) sitzt zwischen PR/Issue-Button und Zähler ein Textfeld „Suche“ (Screenshot im Issue). Tippen grenzt die Liste live ein. Die Suche wirkt nur auf die gerade angezeigte Ansicht: auf die Sessions des aktiven Kontexts, nach Quick-Filter-Chips und PR/Issue-Filter (`shownSessions` in `AgentsView.tsx`). Der Zähler zeigt dann „N of M“, „Clear“ leert auch die Suche.

## Why
Hape hat 169 Agents in der Rail; einen bestimmten findet er heute nur über Scrollen oder die versteckte Filtersyntax im Dispatch-Feld (`a:`, `s:`, `#n`). Ein sichtbares Suchfeld, das die aktuelle Kontext- und Filteransicht respektiert, macht das Wiederfinden zur Sekundensache, ohne dass andere Kontexte in die Treffer rutschen.

## Guardrails
- Matching als reine, getestete Funktion in `utils/agentSessions.ts` neben `applyQuickFilters`, verkettet nach `applyLinkFilter`/`applyQuickFilters` im `shownSessions`-Memo; Muster für case-insensitives Substring-Matching: `filterRows` in `utils/agentTable.ts`.
- Kontextgrenze bleibt: Treffer nur aus `contextSessions`, weil das Issue das ausdrücklich verlangt.
- Bestehende Dispatch-Filtersyntax (`parseFilter`/`applySessionFilter` in `utils/agentInput.ts`) bleibt unverändert; sie ist ein anderer Einstieg.
- Fokus im Suchfeld darf keine Rail-Tastenkürzel auslösen (Pfeile, Zahlen, Enter); Escape leert und verlässt das Feld.
- Aktive Suche behandelt Gruppen wie ein aktiver Quick-Filter (`filterActive`): keine Treffer in eingeklappten Gruppen verstecken.
- Styling wie die Nachbarbuttons (Tailwind, gray-800-Rahmen, `text-xs`), lucide-Icon `Search`; schmale Rail darf nicht überlaufen (Feld `flex-1 min-w-0`).
- Out of scope: Dashboard-Tabelle (`AgentOverview`, hat eigene Suche), Board, Fuzzy-Suche, Persistenz.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Filterzeile zeigt zwischen PR/Issue-Button und Zähler ein Suchfeld (Placeholder „Suche“, `aria-label`), läuft in schmaler Rail nicht über | Screenshot der Rail im laufenden App-Build im PR (`## Screenshots`) |
| AC-2 | Eingabe grenzt die Liste live ein; Treffer über Name, Arbeitsverzeichnis/Projekt, Branch, Agent-Typ, Nummer/Titel verknüpfter PRs/Issues; case-insensitiv; mehrere Wörter = UND; leerer Text = keine Einschränkung | Vitest in `test/` für die Matching-Funktion, `bunx vitest run` grün |
| AC-3 | Suche wirkt nur auf die angezeigte Ansicht: Treffer ausschließlich aus Sessions des aktiven Kontexts und nach aktiven Quick-Filter-Chips und PR/Issue-Filter | Test auf der verketteten Filterfunktion (Session aus anderem Kontext bzw. von Chip ausgeschlossen erscheint trotz Textmatch nicht) plus Screenshot Suche + aktiver Chip im laufenden Build |
| AC-4 | Bei aktiver Suche Zähler „N of M“, „Clear“ leert auch die Suche; Escape im Feld leert und verlässt es | Playwright-Lauf oder Screenshot-Paar vorher/nachher gegen laufende App |
| AC-5 | Tippen im Feld löst keine Rail-Tastenkürzel aus (Pfeile, Zahlen, Enter, Buchstaben) | Playwright-Lauf: Text mit Ziffern tippen, aktive Auswahl/Tab unverändert |
| AC-6 | Aktive Suche versteckt keine Treffer in eingeklappten Gruppen (wie aktiver Quick-Filter) | Test oder Screenshot mit eingeklappter Gruppe, die einen Treffer enthält |
| AC-7 | Unverändert: Dispatch-Filtersyntax (`a:`, `s:`, `#n`), Sortierung, bestehende Tests; Typecheck sauber | `bunx vitest run` komplett grün, `bunx tsc --noEmit` ohne Fehler |

Rückmeldung: kurzer Bericht mit Nachweisen je AC und den getroffenen Annahmen.

## Ambition
- Altitude: keine; eine globale Suche über alle Kontexte (Command Palette) wäre ein anderer Auftrag und widerspricht dem Issue.
- Depth: echte Sessionliste (169 Agents) im laufenden Build; Filtern ohne spürbare Verzögerung beim Tippen (eine Memo-Kette, keine Requests).
- Crew: tut, was eine A11y-Prüfung tut: Feld per Tastatur erreichbar, `aria-label`, Zähler bleibt `aria-live`.

## Prüfung
wegwerf · selbst · reine UI-Filterung ohne Vertrauensgrenze, Daten oder fremde Nutzer; Ausfall kostet nur Komfort.

## First on approval
`applyTextQuery` (Name frei) in `utils/agentSessions.ts` mit Test schreiben.

## Annahmen
- Durchsucht werden Name, Arbeitsverzeichnis/Projekt, Branch, Agent-Typ sowie Nummern und Titel verknüpfter PRs/Issues (vorgeschlagen)
- Suchtext wird nicht gespeichert (nur Komponentenzustand), Kontextwechsel lässt ihn stehen (vorgeschlagen)
- Mehrere Wörter = UND-Verknüpfung (vorgeschlagen)
- `ui: on` für das Issue, da sichtbare UI geändert wird (vorgeschlagen)
