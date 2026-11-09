# Briefing: FORBIDDEN_PATHS schützen auch $HOME/.ssh, .gnupg, .aws, .config (#217)

## The Job
Schlüssel- und Credential-Ordner im Home (`$HOME/.ssh`, `$HOME/.gnupg`, `$HOME/.aws`, `$HOME/.config` samt allem darunter) als Projektordner abweisen, egal ob direkt, per Symlink oder über die #190-Ausnahme für Claudes Config-Dir angefragt. Problem: `validatePath` in `server/services/configService.js` rechnet `path.resolve(HOME, '/.ssh')`, das ergibt `/.ssh`, weil das zweite Segment absolut ist; die Home-Einträge von `FORBIDDEN_PATHS` greifen nie, `~/.ssh` schützt allein die Hidden-Dir-Regel, und die setzt `CLAUDE_CONFIG_DIR=~/.ssh` außer Kraft. Vermutete Lösung (Issue): `path.join` statt `path.resolve`, oder `claudeConfigDir()` verweigert die Ausnahme unter Forbidden-Namen.

## Why
Hape nutzt Orkumo als Arbeitsumgebung; Projektordner werden gescannt und Agents darin gestartet. Ein Agent mit `cwd ~/.ssh` liest Schlüssel. Die Liste soll tun, was sie verspricht, als zweite Verteidigungslinie neben der Hidden-Dir-Regel.

## Guardrails
- Scope: `FORBIDDEN_PATHS`/`validatePath` in `configService.js`, Test in `test/claudeConfigDir.test.js`. Andere Dateien nur, wenn ein bestehender Test durch den Fix bricht.
- Systempfade (`/etc`, `/var`, `/usr` …) bleiben absolut geprüft; ein `path.join(HOME, x)` über die ganze Liste würde `~/bin`, `~/var` usw. sperren.
- Die #190-Kriterien bleiben: `~/.claude` und ein `$CLAUDE_CONFIG_DIR` außerhalb der Forbidden-Bereiche werden angenommen, auch als Symlink; ein Config-Dir über HOME nimmt nichts aus.
- Out of scope: Dateibrowser/WebIDE-Pfadprüfung, neue Forbidden-Einträge, Logging-Umbau.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Server mit `CLAUDE_CONFIG_DIR=<home>/.ssh`: `POST /api/config/directories` mit `<home>/.ssh` wird abgelehnt (4xx), `config.json` enthält den Pfad nicht | neuer Fall in `test/claudeConfigDir.test.js` gegen den echten Server (`server/index.js`, Wegwerf-HOME), rot vor dem Fix, grün danach |
| AC-2 | `<home>/.ssh/sub`, `<home>/.gnupg`, `<home>/.aws`, `<home>/.config` werden abgelehnt, auch mit `CLAUDE_CONFIG_DIR` auf den jeweiligen Ordner | derselbe Test, je Eintrag ein Request |
| AC-3 | Ein Projektordner-Symlink `<home>/PROJECTS/x -> <home>/.aws` wird abgelehnt, auch wenn `CLAUDE_CONFIG_DIR=<home>/.aws` | derselbe Test |
| AC-4 | Nicht-versteckte Home-Ordner mit Systemnamen (`<home>/bin`, `<home>/var`) werden weiter angenommen | derselbe Test |
| AC-5 | Bestehende #190-Fälle (AC-1 bis AC-4 in `claudeConfigDir.test.js`), komplette Suite und Typecheck bleiben grün | `bunx vitest run` und `bunx tsc --noEmit`, Ausgabe im PR |

## Ambition
- Altitude: keine; ein Allowlist-Modell (nur konfigurierte Wurzeln) wäre größer und bräuchte eigene Freigabe.
- Depth: Vergleich segmentweise (vorhandenes `isInside`) und auf dem Real-Pfad (`canonicalDir`), damit Symlinks und macOS-Case-Folding (`/users/me/.SSH`) nicht durchrutschen; die nachgelagerte Symlink-Prüfung (`realPath.startsWith(forbidden)`) deckt dieselben Einträge ab.
- Crew: tut, was ein Sicherheitsprüfer tut: jeden Weg in `validatePath` (direkt, Symlink, Groß/Klein, Traversal, Config-Dir-Ausnahme) gegen die vier Home-Einträge probieren.

## Prüfung
langlebig · unabhängig · Pfadprüfung ist eine Vertrauensgrenze (Eingabe aus der API entscheidet, wo Agents laufen).

## First on approval
Neuen Testfall für AC-1 schreiben und rot laufen sehen.

## Annahmen
- Liste aufteilen in Systempfade (absolut) und Home-Einträge (relativ zu `$HOME`) statt `path.join` über alle Einträge (vorgeschlagen)
- Forbidden-Prüfung hat Vorrang vor der #190-Ausnahme; ein `CLAUDE_CONFIG_DIR` unter `~/.config` (etwa `~/.config/claude`) wird damit nicht mehr als Projektordner angenommen. Hape nutzt das nicht (Env ungesetzt, kein `~/.config/claude`); im PR nennen (vorgeschlagen)
- Nebenbei behoben, weil dieselben Zeilen: Präfixvergleich ohne Segmentgrenze (`/etc` sperrt heute auch `/etcetera`) (vorgeschlagen)
