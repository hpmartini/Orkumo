# Briefing: Agent-Löschen nur nach expliziter Bestätigung

## The Job

Im Agents-View (`/agents`) löscht keine Aktion mehr eine Background-Session ohne ausdrückliche Bestätigung im Dialog. Heute löscht der Eintrag „Delete" im Zeilen-Menü (`components/AgentsView/AgentsView.tsx`, `rowActions` → `deleteSession(session)`) sofort; Ctrl+X löscht per Doppeldruck innerhalb von 2 s (`handleStopOrDelete`, `DELETE_CONFIRM_WINDOW`) und stoppt beim ersten Druck bereits laufende Agents. Nach der Änderung zeigt jeder Einzel-Löschpfad einen Bestätigungsdialog mit Session-Namen; erst „OK" löscht.

## Why

Hape steuert viele parallele Agents über DevOrbit (ADE, siehe `docs/VISION.md`). Ein Fehlklick im Menü oder ein doppeltes Ctrl+X vernichtet Session, Worktree und ggf. Arbeit. Das Issue (#94) fordert explizite Bestätigung mit Nachdruck; ein Versehen soll unmöglich sein, nicht nur unwahrscheinlich.

## Guardrails

- Bestätigung zentral in `deleteSession` (eine Stelle statt pro Aufrufer), weil sonst neue Löschpfade sie wieder umgehen. Die rekursiven Wiederholungen mit `discardUnpushed`/`forceRemoveWorktree` und die Schleife der Gruppenlöschung fragen nicht erneut (sie haben schon bestätigt), z. B. über ein Options-Flag.
- Dialog per `window.confirm`, wie bei der bestehenden Gruppenlöschung und den Hints in `deleteSession`; kein neues Modal-Komponentensystem.
- Annahme: Ctrl+X ersetzt den 2-s-Doppeldruck durch denselben Dialog; der Stopp laufender Agents beim ersten Druck entfällt (gelöscht wird nach Bestätigung ohnehin). Hint-Text und `ShortcutsHelp` entsprechend anpassen; `DELETE_CONFIRM_WINDOW`/`pendingDeleteRef` entfernen, falls ungenutzt.
- Annahme: Dialogtext englisch wie die übrige UI, z. B. `Delete session "<name>"? This removes the session and its worktree.`
- Gruppenlöschung behält ihren bestehenden Confirm.
- Out of scope: Server/`agentService.js`, Remote-Agents, Board, Stop-Aktion (bleibt ohne Rückfrage).

## Done means

- Zeilen-Menü „Delete", Ctrl+X und Command-Palette-Einträge, die löschen, öffnen den Dialog; „Abbrechen" lässt die Session unverändert (kein Stop, kein Remove).
- Ein Unit-Test belegt: Abbruch → `removeAgent` wird nicht aufgerufen; OK → genau ein Aufruf. Bestehende Tests, `bun run build` und Typecheck grün.
- Rückmeldung: kurzer Bericht, was geändert und was angenommen wurde; PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/94`.

## First on approval

Worktree von `origin/main` anlegen und alle Aufrufer von `deleteSession` und `handleStopOrDelete` in `components/AgentsView/AgentsView.tsx` auflisten.
