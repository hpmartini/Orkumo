# Briefing: Quickreply-Darstellung lesbar machen (#178)

Issue: https://github.com/hpmartini/DevHub/issues/178 · Screenshot im Issue (Daten): Peek-Panel in `/agents` zeigt eine Antwort mit verklebten Wörtern („DieverschlepptenFavoritensindaus…“), zerrissenen Tabellen aus Box-Zeichen und eine unlesbare Auswahlzeile („3:Deletesettingsbackup“).

## The Job
Hape liest im Quickreply (Peek-Panel der Agents-Ansicht) die letzte Ausgabe eines Hintergrund-Agents so, wie sie im Terminal aussieht: Wörter mit Leerzeichen, Tabellen und Rahmen als Raster, Auswahloptionen als saubere Liste. Für lange oder breite Ausgaben öffnet er dieselbe Ansicht groß in einem Modal und antwortet von dort aus.

## Why
Hape steuert viele parallele Agents aus `/agents` und entscheidet im Quickreply, was als Nächstes passiert („soll ich X entfernen?“). Ist die Antwort unlesbar, muss er jedes Mal attachen; damit verliert der Quickreply seinen Zweck. Ursache (geprüft): `claude logs <id>` liefert einen rohen TUI-Bildschirmstrom mit Cursor-Bewegungen (`ESC[nC`, `ESC[nG`, `ESC[nB`, `ESC[H`), in dem Leerzeichen und Spaltenpositionen als Cursorsprünge kodiert sind. `PeekPanel.tsx` wirft diese per `stripAnsi` weg und bricht die Zeilen zusätzlich mit `break-words` im 400–460 px breiten Panel um.

## Guardrails
- Ursache beheben, nicht kaschieren: Der Strom wird wie von einem Terminal interpretiert (Cursorsprünge, Zeilenpositionen, Überschreiben), statt Escapes zu entfernen. `@xterm/xterm` ist installiert; ob Headless-Emulation (Server oder Client) oder eine Read-only-xterm-Instanz, entscheidet die Session. Keine neue Abhängigkeit für wenige Zeilen.
- Choice-Erkennung (`extractNumberedChoices` in `utils/agentInput.ts`), Tab-Vorschlag, `!`-Shell-Befehle und Tastenkürzel im Reply-Input funktionieren weiter, gespeist aus dem interpretierten Text.
- Transcript-Fallback (`source: 'transcript'`) und Remote-Sessions (`fetchRemoteAgentLogs`) bleiben funktionsfähig; Remote nur insoweit, als dieselbe Darstellung greift.
- Breite Zeilen (Tabellen, Rahmen) werden nicht umgebrochen, sondern horizontal scrollbar, weil Umbruch das Raster zerstört.
- Mobile-Peek (`md:hidden fixed inset-0`) bleibt nutzbar.
- Out of scope: Attach-Terminal, Agent-Karten, `claude logs`-Aufruf selbst, Transcript-Format.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Ein realer `claude logs`-Rohstrom (als Fixture unter `test/fixtures/` committet, mit Cursor-Escapes) wird zu Text mit korrekten Leerzeichen interpretiert; der Fixture-Satz erscheint mit Wortabständen, kein Text aus überschriebenen Frames bleibt stehen. | Vitest-Test auf die Interpretationsfunktion, grün |
| AC-2 | Eine Tabelle mit Box-Zeichen aus der Fixture bleibt im Ergebnis zeilentreu (jede Tabellenzeile eine Zeile, Spalten bündig); im Panel wird sie nicht umgebrochen, sondern scrollt horizontal. | Vitest-Assertion auf die Zeilen + Screenshot Panel |
| AC-3 | Nummerierte Optionen der Fixture werden als getrennte Choices mit lesbarem Text erkannt (z. B. „Delete settings backup“), Ziffern-Taste sendet weiter die Auswahl. | Vitest-Test `extractNumberedChoices` auf interpretiertem Text |
| AC-4 | Ein Button im Peek-Header öffnet ein Modal (nahezu volle Fensterbreite) mit derselben Ausgabe, Choices und Reply-Input; Esc und Schließen-Button schließen es, Fokus kehrt zurück. | Komponententest (Testing Library) + Screenshot Modal |
| AC-5 | Transcript-Fallback und bestehende Tests unverändert grün; Typecheck und Build laufen. | `bun run test`, `bunx tsc --noEmit`, `bun run build` im PR-Log |
| AC-6 | PR zeigt Vorher/Nachher: Screenshot Panel und Modal mit derselben realen Ausgabe, GIF Panel → Modal → Antwort. | `## Screenshots` im PR, per Playwright erstellt |

Stopp-Regel: weiterarbeiten, außer die Fixture lässt sich mangels laufender Sessions nicht erzeugen (dann aus `claude logs` einer beendeten Session oder synthetisch, als Annahme melden). Rückmeldung: kurzer Bericht, was getan, was angenommen.

## Ambition
- Altitude: Statt Bildschirm-Dump die strukturierte letzte Assistant-Nachricht (Transcript) als Markdown zeigen; würde Emulation überflüssig machen, verliert aber Live-Status und TUI-Auswahlzeile. Nur Vorschlag, nicht Scope.
- Depth: Rohdaten sind echte `claude logs`-Ströme; Zielwert: Fixture-Text 1:1 wie im Terminal (Wortabstände, Raster), Interpretation eines 4000-Zeichen-Stroms < 50 ms, kein Flackern beim 4-s-Polling.
- Crew: tut, was ein Accessibility-Prüfer tut: Modal mit `role="dialog"`, Fokusfalle, Esc, Kontrast der Ausgabe auf `#1a274b` prüfen.

## Prüfung
langlebig · selbst · Kernansicht der täglichen Agentensteuerung, aber keine Vertrauensgrenze und keine Fremdsysteme.

## First on approval
Rohstrom einer realen Session mit `claude logs <id> > test/fixtures/claude-logs-tui.txt` sichern (Inhalt auf Geheimnisse prüfen) und einen roten Test für AC-1 schreiben.

## Annahmen
- Quickreply = Peek-Panel in `components/AgentsView/PeekPanel.tsx` (vorgeschlagen)
- Panel bleibt, Modal kommt zusätzlich als „Vergrößern“, nicht als Ersatz (vorgeschlagen)
- Emulationsbreite folgt der Quellbreite des Stroms (≥ 200 Spalten, `ESC[197G` beobachtet); bei unbekannter Breite großzügig fest, z. B. 220 (vorgeschlagen)
- Anzeige zeigt nur den finalen Bildschirmzustand plus Scrollback des Stroms, keine Frame-Historie (vorgeschlagen)
- `ui: on` für diesen Lauf, weil sichtbare UI sich ändert (vorgeschlagen)
