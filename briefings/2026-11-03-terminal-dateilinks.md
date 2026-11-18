# Briefing: Dateipfade im Terminal öffnen (DevHub #188)

## The Job

Dateipfade, die Agents im DevHub-Terminal ausgeben, per Cmd/Ctrl-Klick direkt auf dem Mac mit der Standard-App öffnen (PDF → Vorschau), so wie URLs heute schon. Erkennen: absolute Pfade, `~/…` und relative Pfade (gegen das Arbeitsverzeichnis der Session aufgelöst); ein angehängtes `:zeile[:spalte]` tolerieren. Fehlende Dateien per Toast melden statt still nichts zu tun. Startbare Ziele nicht ausführen, sondern im Finder zeigen.

Beispiel aus dem Issue (Daten): `/Users/example/docs/2026-11-03_rechnung-entwurf_beispiel.pdf` am Ende einer Agent-Ausgabe.

## Why

Hape arbeitet in DevHub mit Agents, die als Ergebnis Dateipfade ausgeben (Rechnungen, Reports, Screenshots, Briefings). Heute muss er den Pfad kopieren und anderswo öffnen. Ziel dahinter: DevHub als komplette ADE (docs/VISION.md), aus der man für Agent-Ergebnisse nicht herausmuss.

## Guardrails

- Einziger xterm-Terminal ist `components/AgentsView/AgentTerminal.tsx`; dort hängt `WebLinksAddon` mit der Cmd/Ctrl-Klick-Regel aus #140. Dateilinks folgen derselben Regel, damit ein normaler Klick weiter Text markiert. Eigener Link-Provider (`terminal.registerLinkProvider`) neben dem URL-Addon, kein neues npm-Paket.
- Pfaderkennung als reine, unit-getestete Funktion (Muster: `utils/links.ts`, `utils/agentInput.ts`), weil Regex-Kanten (Satzzeichen am Ende, Klammern, `:12:3`, URLs nicht doppelt matchen) sonst nur im Browser prüfbar sind.
- Öffnen läuft über einen neuen Server-Endpoint in `server/index.js` (zod-Validierung wie die übrigen Routen, Rate-Limit wie `agentLimiter`), der `open` per `execFile` ohne Shell aufruft. Grund: ein Weg für Browser und Electron, kein neuer IPC.
- Der Endpoint führt auf dem Host aus, ist also Vertrauensgrenze: nur existierende Dateien oder Ordner; startbare Ziele (`.app`, `.command`, `.sh`, `.tool`, `.terminal`, `.workflow`, gesetztes x-Bit) gehen an `open -R` (im Finder zeigen). Remote-Zugriff bleibt hinter dem bestehenden Pairing-Token (`server/services/remoteAccess.js`); daran nichts lockern.
- URL-Links verhalten sich unverändert (#140).
- Out of scope: Dateivorschau in DevHub, Öffnen in Web-IDE, Links außerhalb des Terminals, Pfade über Zeilenumbrüche.

## Done means

| ID   | Bedingung                                                                                                                                                                          | Nachweis                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | Pfaderkennung findet absolute, `~/`- und relative Pfade samt optionalem `:zeile[:spalte]`, schneidet Satzzeichen am Ende ab und erkennt `http(s)://…` nicht als Pfad               | Unit-Test (bun test) mit den genannten Fällen inkl. Issue-Beispiel, grün                                                                  |
| AC-2 | Endpoint: fehlender Pfad → Fehler (404-artig), Datei/Ordner → `open <pfad>`, startbares Ziel → `open -R <pfad>`, relative Eingabe ohne gültiges cwd → abgelehnt; kein Shell-Aufruf | Server-Test mit gemocktem `execFile`, prüft Argumente je Fall, grün                                                                       |
| AC-3 | Cmd/Ctrl-Klick auf einen Pfad in einer Agent-Session öffnet die Datei; Hover unterstreicht; Klick ohne Modifier markiert nur; falscher Pfad zeigt Toast                            | GIF des Ablaufs im laufenden DevHub (`echo <pdf-pfad>` → Hover → Cmd-Klick → Toast bzw. Server-Log/Vorschau) unter `## Screenshots` im PR |
| AC-4 | URL-Links öffnen wie vorher; `bun run build` und alle bestehenden Tests grün                                                                                                       | Ausgabe von Build und Testlauf im PR                                                                                                      |
| AC-5 | Request von nicht-Loopback ohne Pairing-Token erreicht den Endpoint nicht                                                                                                          | Test oder `curl` mit `X-Forwarded-For` ohne Token → 401, Ausgabe im PR                                                                    |

## Ambition

- Altitude: Ein gemeinsamer „Datei öffnen“-Dienst, den später auch Board-Karten, Briefings und Agent-Peek nutzen; nur vorgeschlagen, nicht Scope.
- Depth: Arbeitet wie iTerm2/Ghostty-Semantic-History: Pfad + Zeile erkennen, gegen cwd auflösen, Existenz prüfen bevor ausgeführt wird. Ziel: kein Fehlklick öffnet etwas Startbares, kein Pfad aus dem Issue-Beispiel wird verpasst.
- Crew: tut, was ein Sicherheitsprüfer tut: Pfad-Traversal, Symlinks auf `.app`, Argument-Injection (`-a`, führendes `-`) und Remote-Aufruf gegen den Endpoint testen.

## Prüfung

langlebig · unabhängig · Neuer Endpoint führt Programme auf dem Host aus und nimmt Eingaben über das Netz an.

## First on approval

`components/AgentsView/AgentTerminal.tsx` und `utils/links.ts` lesen und die Pfaderkennung als reine Funktion mit Tests anlegen (AC-1).

## Annahmen

- Ziel ist immer die Standard-App des Macs, nicht Web-IDE oder Code-Modus; Code-Dateien landen im Standard-Editor. (vorgeschlagen)
- Bei Zugriff von einem anderen Gerät (Remote, iOS) öffnet sich die Datei auf dem Host-Mac; der Toast sagt das. Kein Download/Viewer im Browser. (vorgeschlagen)
- Pfade mit Leerzeichen werden nur in Anführungszeichen erkannt. (vorgeschlagen)
- Relative Pfade nutzen das cwd der Agent-Session; ist es unbekannt, werden nur absolute und `~/`-Pfade verlinkt. (vorgeschlagen)
- `ui: on` für dieses Issue, weil sich das Klickverhalten im Terminal ändert. (vorgeschlagen)
