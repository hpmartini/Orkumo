# Briefing: Bun-Umstellung abschließen (DevHub #42)

## The Job

Die Umstellung von npm auf Bun als Paketmanager ist nachweislich vollständig: keine npm-Lockfiles mehr im Repo, `pty-host/` installiert per Bun, und jeder Punkt der Definition of Done aus Issue #42 ist mit einem Beleg abgehakt. Ergebnis ist ein PR gegen `main` mit dem Rest-Diff und einem Prüfprotokoll; danach kann #42 geschlossen werden.

## Why

Hape vereinheitlicht seine Repos auf Bun (Welle 4, höchstes Risiko wegen node-pty + Electron). Der Großteil ist auf `main` bereits erledigt (Commits `b07bb7f` „Switch package manager from npm to bun", `b47c416` „Fix packaged Electron app startup under bun", `99bf860`): `packageManager: bun@1.2.18`, `trustedDependencies` (node-pty, electron, esbuild), `bun.lock`, Scripts mit `bun run`, Husky `bunx lint-staged`, alle drei Dockerfiles mit Bun-Binary auf `node:20-alpine` plus `python3 make g++`, CI und Release-Workflow mit `setup-bun` + `bun install --frozen-lockfile`. CI auf `main` ist grün. Offen ist, was das Issue als Abnahme fordert, und was der erste Commit übersehen hat. Danach soll Hape das Issue ohne eigenes Nachprüfen schließen können.

## Guardrails

- Bun nur als Paketmanager. Server (`node server/index.js`), `pty-host` und Electron laufen weiter unter Node, weil node-pty unter Bun nicht als kompatibel gilt und der Electron-Main-Prozess Node ist. Keine Runtime-Umstellung.
- Bekannte Lücke: `pty-host/package-lock.json` existiert noch, obwohl `pty-host:install` schon `bun install` aufruft. Ersetzen durch `pty-host/bun.lock`; `trustedDependencies: ["node-pty"]` dort ergänzen, damit der native Build läuft.
- Restliche npm/npx-Spuren suchen und nur dort ändern, wo sie Tooling betreffen (Docs, Scripts, Workflows). `npx` in der Allowlist von `.github/workflows/claude.yml` und historische Einträge in `CHANGELOG.md`/alten Briefings bleiben, weil sie nichts installieren bzw. Geschichte sind.
- Nicht anfassen: Electron-Packaging-Logik (`electron-builder.json`, `scripts/patch-node-pty.cjs`, `scripts/fix-node-pty-binaries.cjs`), solange die Prüfung keinen Fehler zeigt; sie läuft unter Bun bereits (`b47c416`).
- Annahme: Der Electron-Check läuft lokal auf macOS (`bun run electron:build:mac` oder schneller `electron-builder --mac --dir`); Linux-Paket nur über den Release-Workflow, nicht lokal.
- Annahme: `docker compose build` wird lokal geprüft, falls Docker verfügbar ist; sonst gilt ein grüner CI-/Release-Lauf bzw. ein expliziter Vermerk „nicht geprüft, Docker fehlt" als Rückmeldung, kein Blocker.
- Annahme: `.nvmrc` bleibt 20; ein Node-Upgrade ist nicht Teil dieses Issues.
- Repo ist öffentlich: keine lokalen Pfade oder Secrets in PR-Text oder Commits.

## Done means

- `bun install --frozen-lockfile` grün im Root und in `pty-host/`; `git ls-files | grep package-lock` leer.
- `node -e "require('node-pty')"` lädt (Root und `pty-host/`).
- `bun run lint && bunx tsc --noEmit && bun run test:run && bun run build` grün.
- Electron-Build erzeugt eine startbare App; in ihr öffnet ein Terminal-Tab eine Shell (Screenshot oder Log als Beleg).
- `docker compose build` grün (oder Vermerk, s. Annahme).
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/42`, Abschnitt `## Review-Anleitung` und einer Tabelle DoD-Punkt → Befehl → Ergebnis. CI im PR grün.
- Stopp nur, wenn ein DoD-Check an etwas scheitert, das eine Änderung an der Packaging-Logik oder der Runtime erfordern würde: dann Befund berichten statt umbauen.
- Rückmeldung: kurz, was geändert, was geprüft, was angenommen.

## First on approval

Worktree von `origin/main` anlegen und in `pty-host/` `bun install` laufen lassen, um `package-lock.json` durch `bun.lock` zu ersetzen.
