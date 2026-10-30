# Briefing: Mesh-Net – Remote-Agents über Tailscale + SSH (Issue #57)

## The Job

Im AgentsView (`/agents`) gibt es in der Sidebar einen Switch „Remote-Agents“. Ist er an, erscheinen zusätzlich die Claude-Code-Sessions der anderen Geräte im Tailscale-Tailnet, gruppiert nach Gerät. Pro Remote-Session gehen:

- **Liste:** Daten aus `ssh <host> claude agents --json`, gleiche Darstellung wie lokale Sessions, mit Geräte-Kennzeichnung.
- **Attach:** PTY-Tab/Pane mit `ssh -t <host> claude attach <id>`. Die Session läuft auf ihrem Gerät weiter, nichts wird verlagert.
- **Logs (Peek):** `ssh <host> claude logs <id>`.

Geräte kommen automatisch aus `tailscale status --json`: online, OS macOS oder Linux, nicht das eigene Gerät, und SSH per Key ohne Passwort klappt (`ssh -o BatchMode=yes`). Nicht erreichbare Geräte erscheinen ausgegraut mit Grund (offline, SSH verweigert, `claude` fehlt) und einem kurzen Hinweis zur Einrichtung (macOS: Remote Login an, Public Key in `~/.ssh/authorized_keys` des Zielgeräts).

## Why

DevOrbit ist Hapes komplette Arbeitsumgebung für agentische Entwicklung über alle Geräte (`docs/VISION.md`, Abschnitt Mesh; Epic #60, #57 ist Sub-Issue). Hape will Agents auf Desktop, Laptop, peer-a usw. an einer Stelle sehen und anhängen, ohne Sessions zu teleportieren. Später kommen Stop/Reply/Dispatch remote dazu; die Struktur soll das ohne Umbau erlauben (Host als Parameter neben der Session-ID).

## Guardrails

- Mesh = bestehendes Tailscale-Tailnet, Transport = System-`ssh`. Kein eigenes P2P-Protokoll, kein DevOrbit-zu-DevOrbit-API, kein neu geöffneter Port: DevOrbit muss auf den Zielgeräten nicht laufen.
- Nur unmodifizierte `claude`-CLI, kein Token-Auslesen (`briefings/2026-10-22-cloud-remote-sessions.md`).
- Tailscale-CLI: `tailscale` im PATH, sonst `/Applications/Tailscale.app/Contents/MacOS/Tailscale` (so auf Desktop installiert). Fehlt beides: Switch zeigt „Tailscale nicht gefunden“.
- Alle Aufrufe per `execFile`/`spawn` mit Argument-Array, wie in `server/services/agentService.js`. Hostnamen nur aus der Tailscale-Liste übernehmen und zusätzlich per Muster validieren, Session-IDs mit dem bestehenden `agentIdSchema`; ungültig → 400. Remote-Kommando als einzelnes, fest zusammengesetztes Argument ohne Nutzertext.
- SSH-Aufrufe mit `BatchMode=yes` und `ConnectTimeout` (≈5 s), Abfragen parallel, Ergebnis kurz cachen; ein hängendes Gerät blockiert die lokale Liste nie.
- Folge den bestehenden Mustern: Routen unter `/api/agents/*` in `server/index.js`, Attach-PTY über `buildAttachUrl` (`components/AgentsView/AgentTerminal.tsx`, `command`/`args`), reine Logik (Tailscale-JSON parsen, Host-Validierung, Remote-Args bauen) in `utils/` mit Unit-Tests im Stil von `utils/agentInput.ts`. Ist für `command=ssh` in der PTY-Route eine Allowlist nötig, dort eng erweitern.
- Switch-Zustand pro Browser merken (wie bestehende AgentsView-Einstellungen).
- Nicht anfassen: lokale Agent-Funktionen, Board, Docker-/Coding-View, Datenbank.
- Annahme: Auf den Zielgeräten ist `claude` bei nicht-interaktivem SSH im PATH. Falls nicht, als Gerätezustand „claude fehlt“ melden, nicht per Login-Shell-Tricks umgehen, und im Bericht nennen.
- Annahme: Zum Testen ist aktuell kein Gerät per SSH-Key erreichbar (peer-a verweigert Key, laptop offline). E2E gegen echtes Remote-Gerät ist daher optional; Logik per Unit-Tests mit Fixture-JSON belegen.

## Done means

- `bun run lint`, `bun run test`, `bun run build` grün.
- Unit-Tests: Tailscale-Status-Fixture → richtige Geräteliste (offline, iOS/Android, Self rausgefiltert); Host-Validierung (gültig, Shell-Metazeichen, fremder Host); gebaute SSH-Argumente für Liste, Attach, Logs.
- Browser-Check im laufenden Dashboard: Switch an → Gerätegruppen sichtbar, nicht erreichbare Geräte mit Grund; Screenshot als Beleg. Falls ein Gerät per SSH erreichbar ist: Attach-Tab zeigt die Remote-Session.
- Lokale Agent-Liste verhält sich mit Switch aus exakt wie vorher.
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/57` und `## Review-Anleitung` (inkl. SSH-Einrichtung auf einem Zielgerät).
- Rückmeldung: kurzer Bericht mit Dateien, Annahmen, Testbelegen. Weiterarbeiten, außer bei einem Blocker, der Hapes Entscheidung braucht.

## First on approval

Pure Utils mit Tests schreiben (`utils/meshHosts.ts`: Tailscale-JSON → Geräte, Host-Validierung, SSH-Argumente), danach Routen und Switch anschließen.
