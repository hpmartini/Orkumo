# Review #217: forbidden home dirs (feat/217-forbidden-home-paths vs origin/main)

| AC-ID | erfüllt? | Nachweis (Befehl, Ergebnis) |
|---|---|---|
| AC-1 | ja | `bunx vitest run test/claudeConfigDir.test.js` 26/26 grün; auf origin/main mit neuem Test: 8 rot (AC-1, AC-2 x5, AC-3 x2), also rot vor dem Fix |
| AC-2 | ja | derselbe Lauf: .ssh, .ssh/sub, .gnupg, .aws, .config je mit CLAUDE_CONFIG_DIR darauf -> 400 |
| AC-3 | ja | derselbe Lauf: PROJECTS/aws-link -> ~/.aws mit CLAUDE_CONFIG_DIR=~/.aws -> 400; zusätzlich ~/.SSH (darwin) |
| AC-4 | ja | derselbe Lauf: ~/bin, ~/var -> 200 |
| AC-5 | ja | `bunx vitest run` 105 Dateien / 1215 Tests grün; `bunx tsc --noEmit` rc=0; #190-Fälle unverändert grün |

Guardrails: Diff berührt nur `server/services/configService.js`, `test/claudeConfigDir.test.js` und die Briefing-Datei. Systempfade bleiben absolut (`isInside(normalizedPath, '/etc')`), keine neuen Einträge. Das Kriterium „#190 bleibt“ hält.

## Bypass-Probe (addDirectory direkt, Wegwerf-HOME unter /private/tmp/rev217/fs)
Abgelehnt: ~/.ssh als Symlink nach außerhalb (direkt, Ziel direkt, CLAUDE_CONFIG_DIR=Ziel), ~/.AWS, ganzer Pfad in Großbuchstaben, HOME mit Slash am Ende, CLAUDE_CONFIG_DIR mit Slash am Ende, HOME selbst ein Symlink, Anfrage über einen Symlink aufs Home, `//`, `bin/../.aws`, CLAUDE_CONFIG_DIR=~/.config/claude (gewollt, Annahme 2).
Angenommen: HOME nicht gesetzt oder leer, `/private/etc`, `/ETC`.

## Funde
### blocker
keine

### major
keine

### minor
- `server/services/configService.js:67,80`: Ist HOME nicht gesetzt oder leer, werden die Home-Einträge übersprungen (`homeDir ? FORBIDDEN_HOME_DIRS : []`), und die Hidden-Dir-Regel fällt ebenfalls weg; `<home>/.aws` wird dann angenommen. Keine Regression (auf main identisch), im Betrieb kaum erreichbar, weil launchd/Electron HOME setzen. Härtung: auf `os.homedir()` zurückfallen.
- `server/services/configService.js:58-61,102-105`: `/private/etc`, `/private/var` und `/ETC` kommen auf macOS durch, weil die Systemliste nicht auf dem Real-Pfad geprüft wird (`/etc -> /private/etc`). Schon vorher so, laut Vertrag außerhalb des Scopes; eigenes Issue sinnvoll.
- `server/services/configService.js:68-99`: TOCTOU (time of check / time of use) zwischen `canonicalDir` (Z. 69) und `realpathSync` (Z. 99). Das zurückgegebene `realPath` wird nicht noch einmal gegen die Home-Einträge geprüft. Ausnutzen kann das nur, wer lokal Schreibrechte im Home hat; der hat die Schlüssel sowieso.

### nit
- `test/claudeConfigDir.test.js:216`: `not.toContain(dir)` greift im Symlink- und im Case-Fall ins Leere, weil die Config den Real-Pfad speichert, nicht den angefragten. Den Fall trägt allein das 400; besser wäre `expect(stored ?? []).toEqual([])` oder ein Abgleich gegen `fs.realpathSync(dir)`.

## Nicht geprüft
- Bind-Mounts unter Linux (realpath sieht sie nicht) und Symlinks *innerhalb* eines akzeptierten Projektordners, die auf ~/.ssh zeigen: außerhalb von validatePath.
- Ob schon gespeicherte Einträge (etwa ein früher angenommenes ~/.config/claude) beim Start neu validiert werden.
- PR-Text (Annahme 2 nennen) existiert noch nicht.

Ergebnis: freigabefähig, keine blocker/major.
