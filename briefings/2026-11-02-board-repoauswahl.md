# Briefing: Board-Repoauswahl schöner und durchsuchbar (Issue #179)

## The Job

Hape wählt im Board (`/board`, Header) den Slice (Repo, Label, Milestone, Assignee), indem er ein Auswahlfeld öffnet, ein paar Buchstaben tippt und die live gefilterte Liste sofort per Enter oder Klick übernimmt. Die Liste liest sich wie eine gestaltete Auswahl statt wie ein natives `<select>`: Repo-Name hervorgehoben, Owner (`hpmartini/`) dezent, Anzahl als Badge rechtsbündig, Gruppen Favoriten / Repo / Ausgeblendet mit Überschrift, gewählter Eintrag markiert, lange Namen einzeilig abgeschnitten.

## Why

Hape steuert aus dem Board seine Issues über ~25 Repos (Screenshot im Issue: native Dropdown-Liste mit 451 Issues, 24 Einträge `hpmartini/<repo> (n)`). Die native Liste ist nicht durchsuchbar und optisch roh; das Umschalten zwischen Repos ist ein Kernhandgriff im täglichen Workflow und soll mit wenigen Tastendrücken gehen.

## Guardrails

- Code: das zweite `<select>` in `components/BoardView/BoardView.tsx` (~Z. 245–268) wird ein eigenes Popover-Combobox-Element; Filter- und Gruppierlogik als reine Funktion in `utils/board.ts` neben `buildSlices`, getestet in `test/board.test.ts`, damit sie ohne Browser prüfbar ist.
- Bestehende Semantik bleibt: `selectSlice`, URL-State, „Alle (n)“ als erster Eintrag, Gruppen Favoriten/Ausgeblendet, Stern- und Ausblenden-Buttons daneben, Sortierung aus `buildSlices`, Fall „gewählter Wert nicht in Liste“.
- Tastatur darf nicht schlechter werden als beim nativen Select: Pfeiltasten, Enter, Escape (schließt nur das Popover). Popover-Verhalten über `usePopover` aus `components/AgentsView/PullRequestsPanel.tsx`, Optik nach dem `DirectoryPicker` (`components/AgentsView/AgentsView.tsx` ~Z. 2334), damit es zum Rest passt.
- Vorhandene Tailwind-Farben (`gray-850` etc.), keine neue Abhängigkeit.
- Out of scope: Slice-Art-Select (`Repo/Label/…`), Agent-Filter-Select, das Textfeld „Filtern: Titel, #Nr, label:ui“, Mehrfachauswahl, Repo-Avatare.

## Done means

| ID   | Bedingung                                                                                                                                                                                             | Nachweis                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Tippen im Suchfeld filtert die Einträge live, case-insensitiv, Teilstring über den vollen Wert (`tex` → `hpmartini/DocBase`); leere Gruppen verschwinden; kein Treffer zeigt „Keine Treffer“          | Vitest in `test/board.test.ts` für die Filterfunktion                                                                   |
| AC-2 | Enter übernimmt den ersten bzw. per Pfeiltaste markierten Treffer, Klick übernimmt den Eintrag, „Alle“ setzt den Filter zurück; Escape schließt ohne Änderung                                         | Playwright: `/board` öffnen, Picker, `dev` tippen, Enter → Board zeigt nur DevHub-Issues; Escape-Fall                   |
| AC-3 | Gestaltete Liste: Name hervorgehoben, Owner-Präfix dezent, Anzahl als rechtsbündiges Badge, Gruppenüberschriften, Häkchen am aktiven Eintrag, jede Zeile einzeilig mit `…` und vollem Wert im `title` | Playwright-Screenshots im PR (`## Screenshots`): ungefiltert und mit Suche `dev`, Hell nicht nötig (Dark-UI)            |
| AC-4 | Funktioniert für alle vier Slice-Arten (Repo, Label, Milestone, Assignee) und mit Favoriten/Ausgeblendet; Stern/Ausblenden wirken wie bisher                                                          | Vitest für Gruppierung mit Favorit + ausgeblendetem Eintrag; Playwright-Klick auf Slice-Art Label → Picker zeigt Labels |
| AC-5 | Keine Regression                                                                                                                                                                                      | `bun run test:run` und `bun run build` grün                                                                             |

## Ambition

- Altitude: Die Auswahl könnte zusätzlich in der Command Palette (`components/CommandPalette/`) als „Board: Repo wählen“ landen; nur Vorschlag, eigene Freigabe.
- Depth: echte Board-Daten von Hapes Rechner (24 Repos, 451 Issues) als Fixture; Ziel: jedes Repo in ≤ 4 Tastendrücken ab Fokus erreichbar, Öffnen ohne spürbare Verzögerung.
- Crew: tut, was eine Barrierefreiheits-Prüferin tut: `role="combobox"`/`listbox`, `aria-activedescendant`, Fokus kehrt zum Auslöser zurück.

## Prüfung

langlebig · selbst · tägliches UI ohne Vertrauensgrenze; reine Frontend-Änderung, Logik per Test abgedeckt.

## First on approval

Worktree von `origin/main` anlegen und die Filter-/Gruppierfunktion samt Vitest-Fällen (AC-1, AC-4) in `utils/board.ts` / `test/board.test.ts` schreiben.

## Annahmen

- „Textsuche mit Live-Filter“ meint die Auswahlliste selbst, nicht das vorhandene Board-Textfeld (vorgeschlagen)
- Neue Darstellung gilt für alle Slice-Arten, nicht nur Repo, weil es dasselbe Element ist (vorgeschlagen)
- Owner-Präfix bleibt sichtbar, aber dezent; Suche matcht auch den Owner (vorgeschlagen)
- Auslöser-Button zeigt gewählten Wert bzw. „Alle (n)“ in bisheriger Breite (`max-w-56`) (vorgeschlagen)
- `ui: on` sinnvoll, da sichtbare UI (vorgeschlagen)
