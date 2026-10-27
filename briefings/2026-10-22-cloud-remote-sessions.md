# Briefing: Cloud-/Remote-Sessions im AgentsView

## The Job

Im AgentsView (`/agents`) lassen sich Claude-Code-Cloud-Sessions und Remote-Control-Sessions anderer Rechner öffnen, wie in der Claude Desktop App:

1. **Attach per ID/URL:** Eingabefeld für Cloud-Session-ID oder claude.ai/code-URL. Es öffnet `claude --cloud <id|url>` in einem PTY-Tab/Pane, wie bisher `claude attach` (`agentService.js` um Zeile 824, `buildAttachUrl`).
2. **Cloud-Session-Auswahl:** Button „Cloud-Sessions“ öffnet `claude --teleport` (ohne ID, zeigt die Auswahlliste der eigenen Cloud-Sessions) in einem PTY-Tab.
3. **Hinweis in der UI:** Sessions anderer Rechner erscheinen nur, wenn sie dort mit `claude --remote-control` gestartet wurden. Kurzer Hilfetext mit genau diesem Befehl.

## Why

Hape will im Dev-Dashboard alle Claude-Sessions an einem Ort sehen und steuern, auch die von anderen Rechnern und aus der Cloud.
**ToS-Befund (geprüft am 2026-10-22, [code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)):**

- Ein eigener Client, der das OAuth-Token aus dem Keychain liest und die interne claude.ai-Sessions-API aufruft, ist laut Anthropic-Text nicht eindeutig erlaubt.
- Subscription-OAuth ist für „ordinary use of Claude Code and other native Anthropic applications“ gedacht.
- Entwickler dürfen „Claude.ai credentials or session tokens“ nicht „collect, store, or intermediate“.
- Erlaubt ist ausdrücklich: Nutzer meldet sich im **unmodifizierten** Claude-Code-Binary mit seinem Abo an.
- Entscheidung: **kein** Token-Auslesen, **kein** Aufruf der internen API (Risiko: Sperre des Abos). Nur die unmodifizierte `claude`-CLI in einem PTY.

## Guardrails

- Nur `claude`-Flags `--cloud`, `--teleport`, `--remote-control`. Die CLI wird nicht verändert. Kein Zugriff auf `~/.claude` Credentials, Keychain oder Netzwerk-Mitschnitt der Desktop App.
- Eingabe validieren: ID als UUID-/Kurz-ID-Muster oder URL mit Host `claude.ai` und Pfad `/code/…`; ungültig → 400. Aufruf nur per Argument-Array, nie per Shell (wie der Rest von `agentService.js`).
- Folge dem bestehenden Muster: Route unter `/api/agents/*`, PTY wie die Attach-Sessions, Reine Logik (Validierung) in `utils/` mit Unit-Test, Stil wie `utils/agentInput.ts`.
- Nicht anfassen: lokale Agent-Liste (`claude agents --json`), Docker-/Coding-View, Datenbank.
- Uncommittete Änderungen im Repo vorher per `git status` prüfen und erhalten. Nur `.claude/worktrees/` ist untracked.
- Annahme: Die Auswahlliste von `--teleport` funktioniert im PTY ohne TTY-Sonderfälle. Falls nicht, Fallback allein Punkt 1 und das berichten.

## Done means

- `bun run lint`, `bun run test` und `bun run build` laufen grün.
- Unit-Tests für die Eingabe-Validierung: gültige ID, gültige URL, fremder Host, Shell-Metazeichen.
- Im laufenden Dashboard (Browser-Check): ein PTY-Tab startet mit `claude --teleport`, Screenshot oder Terminalausgabe als Beleg.
- Rückmeldung: kurzer Bericht mit Dateien, Annahmen und dem ToS-Befund als eine Zeile. Weiterarbeiten, außer bei einem Blocker, der Hapes Entscheidung braucht.

## First on approval

Validierungs-Util mit Tests schreiben (`utils/cloudSession.ts`), danach Route und PTY-Start im `agentService.js` anschließen.
