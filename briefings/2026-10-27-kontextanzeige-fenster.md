# Briefing: Kontextanzeige rechnet mit falschem Kontextfenster (#102)

## The Job

Der Kontext-Balken im Cache-Badge der Agents-View (`components/AgentsView/CacheBadge.tsx`) zeigt die Füllung gegen das echte Kontextfenster des Modells. Für eine Opus-5.5-Session mit 167k Tokens heißt das: ~17 %, blauer Balken, nicht rot. Die Zahl neben dem Balken ist klar als _belegte_ Tokens erkennbar, nicht als freie.

Befund (verifiziert): Die Anzeige zeigt belegte Tokens (Prompt-Tokens des letzten Turns), nicht freie. Falsch ist der Nenner. `contextWindowFor()` in `server/services/agentContextService.js:263` nimmt 200k an, solange die Modell-ID kein `[1m]` trägt und die Nutzung ≤ 200k ist. Transcripts und `--model`-Flags enthalten nie `[1m]` (geprüft: `claude-opus-5-5`). Claude Code selbst meldet für Opus 5.5 `context_window_size` = 1M (Hapes Statuszeile `~/.claude/awesome-statusline.sh` liest das: 167k/1M = 16 %). 167k/200k = 84 % → roter Balken ab 80 %.

## Why

Hape steuert Agents über die Agents-View und entscheidet anhand des Balkens, ob eine Session kompaktiert oder neu gestartet werden muss. Ein falsch roter Balken löst unnötige Neustarts aus und untergräbt das Vertrauen in alle Badges. Die Anzeige muss dasselbe sagen wie die Claude-Code-Statuszeile.

## Guardrails

- Fix in `contextWindowFor()` (eine Stelle, Server), weil Client und Typ `AgentCacheInfo` den Wert nur durchreichen. Signatur bleibt.
- Modell → Fenster als kleine Tabelle mit Präfix-Match auf die Modell-ID; `[1m]`-Suffix und die >200k-Heuristik bleiben als Fallback.
- Annahme: Opus 5.x und Fable 5.x haben in Claude Code standardmäßig 1M, Sonnet/Haiku 200k. Belegt ist nur Opus 5.5 (Statuszeile); Rest vor Umsetzung mit claude-code-guide/Doku abgleichen, sonst nur Opus 5.x eintragen.
- Annahme: Sichtbarer Text im Badge wird `167k · 17%` statt nur `167k`; Tooltip (`Context: x / y tokens (p%)`) bleibt. Rote Schwelle 80 % bleibt.
- Out of scope: Statuszeile, Cache-Countdown, Hit-Zählung, Transcript-Parsing, Modellerkennung (`sessionModel`).

## Done means

- `bun run test` (bzw. vitest) grün; `test/agentContextService.test.js` „derives the context window“ angepasst: `claude-opus-5-5` + 150k → 1M, `claude-sonnet-…` + 150k → 200k, `[1m]` und null+300k wie bisher.
- `utils/agentCache.test.ts` und CacheBadge-Tests (falls vorhanden) grün.
- Im laufenden DevOrbit zeigt eine Opus-5.5-Session denselben Prozentwert wie die Statuszeile (±1 %), Screenshot im PR.
- Rückmeldung: PR mit `Closes https://github.com/hpmartini/DevHub/issues/102`, `## Review-Anleitung`, Liste der Annahmen und welche Fenster belegt sind.

## First on approval

`contextWindowFor` in `server/services/agentContextService.js:263` auf Modell-Tabelle umstellen und den Test dazu zuerst rot schreiben.
