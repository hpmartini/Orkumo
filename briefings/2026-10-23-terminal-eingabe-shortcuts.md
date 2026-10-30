# Briefing: Terminal-Eingabe zuverlässig + macOS-Shortcuts (DevHub#65)

## The Job

Alle xterm-Terminals in DevOrbit nehmen Eingaben verlustfrei an und verhalten sich bei den gewohnten macOS-Shortcuts wie Ghostty/iTerm:

- **Text-Eingabe und Copy-&-Paste kommen immer vollständig in der Shell an** (MAJOR: aktuell gehen Eingaben teilweise verloren). Ursache gefunden und an der gemeinsamen Stelle behoben, nicht pro Symptom umgangen.
- **Option+Backspace** löscht das Wort links vom Cursor (`\x17` bzw. `ESC DEL`).
- **Cmd+Backspace** löscht bis Zeilenanfang (`\x15`, Ctrl+U).
- **Cmd+W** bei fokussiertem Terminal schließt nur den aktiven Terminal-Tab, nie Fenster/App.
- Betroffen: `components/XTerminal.tsx` (Detailansicht und CodingView `TerminalsPanel`), `components/AgentsView/AgentTerminal.tsx`, ggf. `ClaudeTerminalModal.tsx`. Die Shortcut-Logik lebt einmal (z. B. `utils/terminalKeys.ts`, rein und unit-getestet) und wird von allen `attachCustomKeyEventHandler`-Stellen genutzt; dort steckt heute dreifach kopiert nur der Shift+Enter-Handler.

## Why

DevOrbit soll Hapes komplette Arbeitsumgebung für agentische Entwicklung werden (`docs/VISION.md`); das Terminal ist der Ort, an dem er Agents anweist. Ein Terminal, das Eingaben oder Pastes verschluckt, ist unbenutzbar, und fehlende Standard-Shortcuts treiben ihn zurück zu Ghostty.

## Guardrails

- Root cause vor Fix. Verdachtsstellen, unbestätigt: Reconnect-Pfad in `XTerminal.tsx` (~Zeile 556) registriert `onData`/`attachCustomKeyEventHandler` erneut, ohne die alten Disposables freizugeben, und alte Listener halten veraltete `ws`-Referenzen; globale `keydown`-Listener mit `capture: true` (`AgentsView.tsx` ~1032, `AgentList.tsx` ~339, `AgentWorkspace.tsx`, `App.tsx`, Command Palette) fangen Tasten ab, während das xterm-Textarea Fokus hat; Electron-Menü-Accelerators; Input-Pfad zum PTY (`server/services/ptyService.js`, `pty-host/`) bei großen Pastes. Belege mit Repro, bevor du änderst.
- Globale Shortcut-Handler ignorieren Events, deren Ziel im Terminal liegt (`.xterm` / `closest('.xterm')`), statt dass jedes Terminal sich einzeln wehrt.
- Bestehendes Verhalten bleibt: Shift+Enter → `\x1b[13;2u`, F6 → Fokus zurück zur Rail, Cmd+C/Cmd+V, Ghostty-Theme.
- Annahme: Cmd+W wird in der Electron-App ausgeliefert (Menü-Accelerator auf „Tab schließen“ umleiten, wenn Terminal fokussiert). Im reinen Browser darf Chrome Cmd+W nicht abfangen lassen; dort reicht Best Effort, im PR dokumentiert.
- Annahme: Cmd+W ohne fokussiertes Terminal behält bisheriges Verhalten.
- Annahme: Option als Meta (`macOptionIsMeta`) wird nicht global eingeschaltet, weil sonst Sonderzeichen wie `@`/`€` auf DE-Tastatur brechen; nur Option+Backspace wird gezielt gemappt.
- Kein neues Dependency. Nicht anfassen: Mesh/Remote-Logik (#57), Board (#44), Layout/Design der Tabs.
- Subagenten: höchstens 2 (z. B. einer für die Root-Cause-Suche im Input-Pfad).

## Done means

- Unit-Tests für die Key-Mapping-Funktion (Option+Backspace, Cmd+Backspace, Cmd+W, Shift+Enter, Durchlass normaler Tasten) und ein Test, der den Root Cause des Eingabeverlusts reproduziert und jetzt grün ist.
- `bun run lint`, `bun run test`, `bun run build` grün.
- Manueller Beleg in der laufenden App (Playwright oder Screenshot/GIF): 2-KB-Paste kommt vollständig in `cat > /tmp/x; wc -c` an; schnelles Tippen in Detail-Terminal und Agent-Terminal ohne Verlust; die drei Shortcuts funktionieren; Cmd+W schließt nur den Tab.
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/65` und `## Review-Anleitung`.
- Rückmeldung: kurze Bullets mit Root Cause, Fix, geänderten Dateien, getroffenen Annahmen. Weiterarbeiten, außer der Root Cause ist ohne Hapes Repro-Schritte nicht findbar; dann gezielt nachfragen.

## First on approval

Eingabeverlust reproduzieren: App starten (`bun run dev`), Terminal-Tab in der Detailansicht und ein Agent-Terminal öffnen, schnell tippen und großen Text pasten, dabei WebSocket-Frames und globale `keydown`-Listener beobachten.
