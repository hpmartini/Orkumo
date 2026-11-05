# Briefing: iOS-App nach DevHub-pro auslagern (#180)

## The Job

Die iOS-App (Capacitor-Hülle aus #120) aus dem öffentlichen DevHub entfernen und im privaten Repo `hpmartini/DevHub-pro` so bauen, dass Hape sie wie heute per Xcode auf iPhone und iPad installiert, koppelt und Agents, Board und Terminal bedient. Die Repo-Frage aus dem Issue beantworten und begründet festhalten: alle Pro-Apps und -Module in DevHub-pro (Monorepo mit `apps/<name>` und `modules/<name>`) oder je App ein eigenes Repo. Öffentliches DevHub enthält danach kein `ios/`, keine `@capacitor/*`-Abhängigkeit und keinen Capacitor-Code mehr, bleibt aber als Server für mobile Clients fähig (Remote-Zugang, Token, Pairing-Daten).

## Why

Hape macht DevHub öffentlich und verkauft einzelne Teile als Pro (erstes Modul: Workflow-Ansicht, #165). Die iOS-App ist die erste Pro-App; weitere (Android, iPad-spezifisch, Watch) sollen folgen. Die Struktur, die hier entsteht, ist die Vorlage dafür: eine neue App soll ohne Änderung am öffentlichen Repo andocken.

## Guardrails

- Zwei Repos, je ein PR, kein Merge: DevHub (Branch `feat/180-ios-pro`, Worktree `.claude/worktrees/180-ios-pro`) und DevHub-pro. Im Haupt-Checkout nichts ändern, dort arbeitet Hape.
- Ins Pro-Repo ziehen: `ios/`, `capacitor.config.json`, `@capacitor/*`, Skripte `ios:sync|open|e2e` samt `scripts/ios-e2e.sh`, `components/PairingScreen.tsx`, Deep-Link-/Pairing-Bootstrap aus `index.tsx`, `docs/ios/`, README-Abschnitt iOS (öffentlich bleibt ein Verweis auf Remote-Zugang ohne App-Anleitung). Git-Historie der Dateien muss nicht mit.
- Öffentlich bleiben, weil der Server die Vertrauensgrenze ist und auch andere Clients (Browser übers Tailnet) sie brauchen: `server/services/remoteAccess.js`, Token-Prüfung, `/api/remote/pairing`, `RemotePairingSection` im Admin-Panel, `utils/remoteClient.ts`/`apiConfig` soweit generisch. Die CORS-Freigabe für `capacitor://localhost` bleibt hinter `DEVORBIT_REMOTE`.
- Die App bündelt den DevHub-Web-Build. Das Pro-Repo baut gegen einen DevHub-Checkout (Pfad per Env, z. B. `DEVHUB_DIR`, oder Submodul) mit eigenem Einstieg, der DevHubs `App` einbettet und Capacitor-Teile ergänzt. Öffentliches DevHub darf dafür einen kleinen, generischen Einstiegspunkt anbieten (z. B. exportierte `App` + Hook für Client-Auth), aber kein Capacitor-Wissen.
- Mit #165 abstimmen: Wer DevHub-pro zuerst committet, legt das Gerüst; das andere Issue fügt sich ein. Layout `apps/ios`, `modules/workflows`, Root-README mit Build je Teil.
- Out of scope: neue App-Features, Android, TestFlight/App Store, Lizenz-/Bezahlprüfung in der App.
- Höchstens 3 Subagenten.

## Done means

| ID   | Bedingung                                                                                                                   | Nachweis                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-1 | DevHub ohne iOS baut, linted und testet grün                                                                                | `bun run build`, `bun run lint`, `bun run test:run` mit Exit 0, Ausgabe im PR                                                                                                                         |
| AC-2 | DevHub enthält kein `ios/`, kein `capacitor.config.json`, keine `@capacitor/*`-Abhängigkeit, keinen Import aus `@capacitor` | `git ls-files ios capacitor.config.json` leer; `grep -rn "@capacitor" --exclude-dir=node_modules --exclude-dir=docs --exclude-dir=briefings .` leer                                                   |
| AC-3 | Desktop-Browser und Electron unverändert; Remote-Zugang samt Token-Prüfung funktioniert weiter                              | bestehende Tests `remoteAccess`, `RemotePairingSection` grün; `curl` mit `DEVORBIT_REMOTE=true` ohne Token von Nicht-Loopback → 401, mit Token → 200 (oder Test, der das abdeckt)                     |
| AC-4 | DevHub-pro baut die App aus einem frischen Klon gegen einen DevHub-Checkout                                                 | Befehlsfolge laut DevHub-pro-README (`bun install`, Web-Build, `cap sync ios`, `xcodebuild … iPhone 16 Simulator`) mit Exit 0, Ausgabe im PR                                                          |
| AC-5 | App im Simulator gegen lokalen Server mit `DEVORBIT_REMOTE=true`: Pairing, Agents-Liste, Board, Attach-Terminal             | `ios:e2e` bzw. `AppUITests/PairingFlowTests` grün im Pro-Repo; Screenshots iPhone + iPad im PR                                                                                                        |
| AC-6 | Repo-Entscheidung festgehalten                                                                                              | `docs/ADR-001-repo-struktur.md` (o. ä.) in DevHub-pro: Optionen Monorepo vs. Repo je App, Kriterien (Zugriff, Release-Zyklus, gemeinsamer Build gegen DevHub, CI-Kosten), Entscheidung, Umstiegspunkt |
| AC-7 | Öffentliche Doku verweist korrekt                                                                                           | README DevHub: iOS-Abschnitt ersetzt durch Remote-Zugang + Hinweis auf Pro-App; `docs/MODULES.md` oder README von DevHub-pro beschreibt, wie Apps gegen DevHub bauen                                  |

## Ambition

- Altitude: App als dünne Hülle, die die UI vom eigenen Mac-Server lädt (`server.url` übers Tailnet) statt sie zu bündeln; entkoppelt App-Releases von DevHub-Versionen. Nur vorgeschlagen, eigene Freigabe.
- Depth: Build-Reproduzierbarkeit messen (frischer Klon → Simulator-Build in einem Befehl); DevHub-Version, gegen die gebaut wurde, in der App sichtbar (z. B. Admin-Info), damit Versionsdrift auffällt.
- Crew: tut, was ein Sicherheitsprüfer tut (prüft, dass nach dem Umzug kein Token-Pfad oder CORS-Eintrag ohne `DEVORBIT_REMOTE` offen ist); tut, was ein Release-Engineer tut (Build-Skript in DevHub-pro pinnt die DevHub-Revision).

## Prüfung

langlebig · unabhängig · Die Repo-Struktur ist Vorlage für alle künftigen Pro-Apps, und der Umbau berührt Remote-Zugang und CORS (Vertrauensgrenze).

## First on approval

In DevHub-pro prüfen, ob #165 schon ein Gerüst committet hat; dann den App-Einstieg festlegen (wie die Pro-App DevHubs `App` einbindet) und daraus die minimale generische Änderung am öffentlichen `index.tsx` ableiten.

## Annahmen

- Monorepo DevHub-pro mit `apps/` und `modules/`, weil ein Eigentümer, eine Zugriffsgrenze, ein Build gegen DevHub; Umstieg auf Repo je App erst bei eigenem Team oder eigenem Release-Zyklus einer App. (vorgeschlagen)
- Pro-App bündelt weiter den Web-Build (wie #120), gebaut gegen einen per Env angegebenen DevHub-Checkout mit gepinnter Revision; kein npm-Paket für DevHub. (vorgeschlagen)
- Server-Remote-Zugang, Pairing-Endpunkt und Admin-Pairing-Anzeige bleiben öffentlich; „Pro“ ist die App, nicht der Zugang. (vorgeschlagen)
- Bundle-ID `de.martinilabs.devorbit` und Signing (Personal Team) bleiben, damit installierte Apps ihr Pairing behalten. (vorgeschlagen)
- `ui: off`: sichtbare UI der App ändert sich nicht; Screenshots belegen nur Gleichstand. (vorgeschlagen)
