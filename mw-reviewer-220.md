# Review #220 Mesh (Blackbox gegen contract-220.md)

Basis: Orkumo `0fb0e8f` (+ uncommittete Änderung `server/index.js`), DevHub-pro `ca4d227` (= gelieferter Diff). Während des Reviews kam DevHub-pro `012dddc` dazu (behebt F-M2, F-M3), mitgeprüft.

## AC

| AC | erfüllt? | Nachweis (Befehl, Ergebnis) |
|---|---|---|
| AC-1 | ja | `SKIP_CHECKS=1 DEVHUB_PRO_SRC=… scripts/review/220.sh` → PASS: Picker am Label, alle Sessions von B gelistet, keine lokale Zeile (≈ genau: zusätzliche Zeilen würden den Check nicht scheitern lassen). Screenshots in `review-220-shots/`, aber nicht im PR (kein PR). A läuft im Skript ohne `DEVORBIT_REMOTE=true`, nur B |
| AC-2 | ja | e2e PASS: Attach läuft auf B, Eingabe „hallo mesh“ erreicht B-PTY, lokal kein Attach; `flow.gif` vorhanden |
| AC-3 | ja | e2e PASS: `--bg`, `stop peer-b2`, `respawn peer-b2` nur im argv-Log von B, lokal `[]` |
| AC-4 | ja | e2e PASS: Peek zeigt „log of peer-b2 on peer-b“, Chat-SSE „pong from peer-b“ |
| AC-5 | ja | e2e PASS: Tab bleibt offen, kein Re-Attach, „noch da“ erreicht B |
| AC-6 | ja | e2e PASS: kein Picker ohne Modul; `npx vitest run` 1185/1185 (erster Lauf: 1 Timeout in `cardDetailsMigration.test.js` unter Last, allein 3x grün, voller Rerun grün; flaky, nicht #220) |
| AC-7 | ja (für ca4d227 mit Lücke F-M2) | DevHub-pro `ORKUMO_DIR=… vitest run` → `mesh.integration.test.js` 7/7: 401 fremd/fehlend (HTTP+WS), 400 unbekannter Host/Pfad, 403 Cross-Site-WS |
| AC-8 | ja | `mesh.test.js` (Fixture) 12/12; Integrationstest: hängender Peer, `/api/agents` < 1 s, Peer `online:false` |
| AC-9 | ja | Integrationstest `hello` → `{name, version:'0.1.0', sessions:1}` |
| AC-10 | ja | `git grep -n "meshService\|buildSshAttachArgs\|agents/remote"` → nur Treffer `scripts/review/220.sh:31` (die Prüfzeile selbst), `tsc --noEmit` exit 0 |
| AC-11 | ja | `docs/MODULES.md`: Slot `agents-rail`, Agent target, `onUpgrade`, `addAuthorizer`, `dataDir`; Modul nutzt genau diese |
| AC-12 | teilweise | Orkumo: `bun run lint` 0 Fehler, `bun run build` ok, Tests grün. DevHub-pro: `tsc` 0, Tests 48/48, `build` ok; `bun run lint` gibt es dort nicht („Script not found“) → nicht prüfbar. Kein CI/PR-Log |
| AC-13 | nein | `gh pr list --head feat/220-mesh --state all` leer in beiden Repos |
| AC-14 | nicht prüfbar | optional, laut Vertrag offen; echtes `tailscale serve` (Header-Überschreiben, XFF) damit ungetestet |

**Urteilsbasis:** Funde gelten für die gelieferten Diffs. Die Nachweise liefen gegen den Worktree-Stand (DevHub-pro ca4d227→012dddc, Orkumo 0fb0e8f + uncommittete Änderung). Bevor F-M2/F-M3 und F-m2 als behoben gelten, braucht es einen neuen Diff.

## Funde

### blocker

- **F-B1 Tailnet-weites CSRF über den Authorizer** – `DevHub-pro src/mesh/peers.js:504-509` (`isOwnerViaServe`), angehängt in `src/mesh/index.js:242`. Der Authorizer prüft weder `Origin` noch `Sec-Fetch-Site`. Szenario: Hape öffnet auf Laptop eine bösartige Seite. Die schickt ein Formular-POST (simple request, ohne Preflight) an `https://desktop.<tailnet>.ts.net:3443/api/agents/respawn-all`, `/api/code-server/stop` oder `/api/agents/<id>/stop`. `serve` setzt Hapes Login und die Laptop-IP, der Authorizer sagt ja, die Aktion läuft. Vorher brauchte jeder Aufruf über `serve` das Pairing-Token, das eine fremde Seite nicht kennt. Ein zweites Gerät ist nicht nötig: `parseStatus` nimmt auch `Self.TailscaleIPs` in `ips` auf (`peers.js:476`). Der Authorizer gilt global (`remoteAccess.isAuthorized`), also auch auf dem bestehenden iOS-`serve`-Pfad (443/8443): Anfragen mit dem eigenen Login brauchen dort kein Pairing-Token mehr. Das widerspricht der Vertragsannahme „öffnet nichts Neues“. Reichweite: nur POSTs, die ohne Body wirken (`express.json` parst keinen Formular-Body), also `respawn-all`, `/agents/:id/stop`, `/code-server/stop`; JSON-Routen und DELETE lassen sich nicht per Formular auslösen. Gilt weiter in `012dddc`. Fix: Authorizer gibt `false`, wenn `Origin` gesetzt und nicht erlaubt ist oder `Sec-Fetch-Site` nicht `same-origin`/`none` ist; der Relay von A sendet keins davon.
### major

- **F-M4 AC-13 nicht erfüllt** – kein PR in Orkumo oder DevHub-pro (`gh pr list --head feat/220-mesh --state all` leer); damit fehlen auch Screenshots/GIF im PR (AC-1, AC-2).
- **F-M5 AC-12 nicht nachweisbar wie formuliert** – DevHub-pro `package.json` hat kein `lint`-Skript; „`bun run lint` grün in DevHub-pro“ ist unmöglich. Skript ergänzen oder AC anpassen; außerdem fehlt ein CI-/PR-Log.
- **F-M2 (behoben in 012dddc) Relay verlässt `/agents` per `%2e%2e`** – `src/mesh/index.js:324` (ca4d227). Der Filter prüft `..`, aber `new URL()` in `peerRequest` (`:172`) normalisiert `%2e%2e`. Nachweis: `new URL('/api/agents/%2e%2e/settings/agent-view', …)` → `/api/settings/agent-view`, `/api/agents/%2E%2E/pty` → `/api/pty`. Damit war jeder API-Pfad des Peers erreichbar, also auch mit SSRF über manuelle Peers. In `012dddc` behebt das `isAgentsPath` (Prüfung nach der Normalisierung); Probe gegen 2 echte Server → 400.
- **F-M3 (behoben in 012dddc) Pairing-Token im Query wird an Peers weitergereicht** – `src/mesh/index.js:336,371` (ca4d227) leiten `?token=` von SSE und WS an den Peer weiter. So bekommt der Peer das Token von A. In `012dddc` entfernt `relayQuery` das Token.

### minor

- **F-m1 Relay entfernt Origin, umgeht dadurch die Cross-Site-Sperre des Peers** – `src/mesh/index.js:121,317-358`. `POST /api/agents/servers/:pid/stop` sperrt Cross-Site (`server/index.js:1544`). Nachweis: direkt → 403 „Cross-origin request refused“, über `localhost/api/modules/mesh/peer/b/agents/servers/999999/stop` mit `Origin: https://evil.example` → 404 (die Route wurde erreicht). Fix: Der Relay lehnt Cross-Site-Anfragen selbst ab, wie die Orphan-Route.
- **F-m2 WS-Origin-Check per DNS-Rebinding umgehbar (ohne Remote-Modus)** – `server/index.js:2205-2213` (0fb0e8f). `Origin`-Host = `Host` lässt einen umgebogenen Namen durch, und ohne `DEVORBIT_REMOTE` ist `isAuthorized` immer true → PTY. Uncommittete Änderung im Worktree (`if (!isRemoteEnabled()) return false`) behebt es, ist aber nicht im Diff → committen.
- **F-m3 Manuelle Peers dürfen auf jedes Ziel zeigen** – `src/mesh/peers.js:443-449`, `index.js:277`. `peerOrigin` lässt `http://169.254.169.254`, `127.0.0.1:<port>` und LAN-Adressen zu. Nach F-M2-Fix ist der Pfad auf `/api/agents*` beschränkt; Aufrufer müssen autorisiert sein. Vertraglich gewollt (manuelle URL, lokaler Test), aber SSRF-Oberfläche bleibt; ggf. dokumentieren.
- **F-m4 Peer-Name mit `,`/`=` zerstört peers.json-Lesen** – `index.js:227-236`. `readManual` baut aus JSON wieder `name=url,…` und parst neu. Ein Name mit Komma lässt den Eintrag beim Lesen verschwinden oder zerlegt ihn. Die Objekte direkt validieren statt über den String-Umweg.
- **F-m5 `seen`-Map wächst unbegrenzt** – `components/AgentsView/AgentsView.tsx` (`seen`/`foreignPanes`, Diff-Z. 113-127). Jede je gelistete Session bleibt als Pane-Kandidat und wird nie entfernt, solange ihre Instanz nicht gewählt ist; auch gelöschte Peer-Sessions.
- **F-m6 AC-1-Aufbau** – `scripts/review/220.sh:1400`: A ohne `DEVORBIT_REMOTE=true`. Der Vertrag nennt den Remote-Modus für beide; Pfad A→B läuft über Loopback ohne Authorizer, der Authorizer-Pfad bleibt in der e2e ungeprüft (nur im Integrationstest mit gefälschten Headern).
- **F-m7 Flaky Test** – `test/cardDetailsMigration.test.js:82`: 60-s-Timeout unter Volllast in `220.sh`. Die Abbruchlogik (`set -e`) stoppt dann das ganze Review-Skript vor der e2e.

### nit

- AC-10-Grep nicht wörtlich leer (Selbsttreffer `220.sh:31`); das Skript schließt sich selbst aus, Vertragsbefehl nicht.
- `scripts/review/207-e2e.cjs:1` `/* global document */` entfernt; Lint grün, unbeteiligte Datei.

## Guardrails

- SSH-Mesh entfernt (Dateien, Routen, `ssh`-Allowlist, Tests): ok.
- Lokale Agent-Logik (`agentService.js`), Board, Code-Modus, iOS-App: nicht im Diff. ok.
- Manuelle Peer-URLs: Vertrag „im Admin-Panel“; umgesetzt als Formular im Picker-Dropdown (`src/mesh/ui.js:673-696`) plus `DEVORBIT_MESH_PEERS`. Abweichung (minor); e2e nutzt nur die Env-Variable, `POST /peers` und das Formular sind nirgends end-to-end getestet.
- API-/WS-Präfix: Vertrag „in `utils/apiConfig`“; liegt in `utils/agentTarget.ts`. Abweichung (nit), in `docs/MODULES.md` korrekt beschrieben.
- `tailscale serve`-Einrichtung per Knopf im Admin-Panel (Annahme): nicht umgesetzt, nur Befehl im Picker angezeigt (`index.js:264`). Laut Annahme reicht der dokumentierte Befehl.
- Prüfskripte/Gates: keine bestehenden Gates geändert, nur neue `220*`-Skripte.
- Uncommittet: `server/index.js` (F-m2-Fix) – nicht Teil des Diffs, Tests liefen mit ihm.

## Nicht geprüft

- Echtes `tailscale serve` (überschreibt es `Tailscale-User-Login` wirklich, setzt es `X-Forwarded-For` mit der Client-IP als letztem Hop, Funnel ohne Login-Header): nur angenommen, AC-14 offen.
- Ob Chromes Local-/Private-Network-Access-Sperre F-M1 für 100.64/10-Ziele abfängt: browserabhängig, nicht getestet.
- Latenzziel (< 1 s Umschalten, Attach im Tailnet).
