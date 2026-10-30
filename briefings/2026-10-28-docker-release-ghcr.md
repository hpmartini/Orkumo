# Briefing: Docker-Images als Release-Download (Issue #35)

Issue: https://github.com/hpmartini/DevHub/issues/35 — „make the Electron and the Docker app downloadable releases here on GitHub“

## The Job

Jedes veröffentlichte GitHub-Release liefert neben den Electron-Installern auch die Docker-App: Der Release-Workflow baut die Images der Compose-Stack (`Dockerfile.api`, `Dockerfile.frontend`) für `linux/amd64` und `linux/arm64`, pusht sie nach GHCR mit der Release-Version als Tag, und hängt eine Compose-Datei ans Release, mit der jemand ohne Repo-Checkout und ohne lokalen Build die Stack per `docker compose up -d` startet. Die Doku sagt in wenigen Zeilen, wie man Desktop-App oder Docker-Stack aus dem Release holt.

## Why

Hape will DevOrbit ohne Build-Kette verteilen und selbst auf anderen Rechnern installieren. Der Electron-Teil läuft bereits: `.github/workflows/release.yml` hängt bei `release: published` DMG/ZIP (macOS arm64, x64), AppImage/DEB/RPM (Linux x64) an, Releases v1.0.0-rc4 bis rc7 sind grün. Offen ist nur Docker: Heute gibt es keine veröffentlichten Images, `docker-compose.yml` baut lokal aus dem Checkout.

## Guardrails

- Electron-Jobs in `release.yml` bleiben funktional unverändert, weil sie seit rc4 zuverlässig laufen. Docker kommt als eigener Job im selben Workflow (gleicher Trigger `release: published`) oder als eigener Workflow dazu.
- Actions mit Commit-SHA pinnen wie im bestehenden Workflow; `permissions` nur so weit wie nötig (`packages: write` nur im Docker-Job).
- `docker-compose.yml` (lokaler Build) bleibt nutzbar; das Release bekommt eine separate Compose-Datei mit `image:` statt `build:`. Abhängigkeiten von Repo-Dateien (z. B. `docker/init-db.sql`, `nginx.conf`) müssen im Image stecken oder mit ans Release, weil der Nutzer kein Repo hat.
- Keine Secrets in Images oder Compose; Passwörter bleiben `${VAR}` aus `.env`, wie im bestehenden Compose.
- Der PTY-Host läuft weiter auf dem Host (`pty-host/`), nicht im Container; die Doku nennt ihn als Voraussetzung für Terminals. Das Containerisieren des PTY-Hosts ist out of scope.
- Out of scope: Windows, Code-Signing/Notarisierung, Auto-Updater (#126), All-in-one-`Dockerfile`, Docker Hub.
- Kein Tag, kein Release und kein Push auf main durch die Session; Releases veröffentlicht Hape.

## Done means

| ID   | Bedingung                                                                                                                                                                                                                  | Nachweis                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Der Release-Workflow enthält einen Docker-Job, der bei `release: published` beide Images für `linux/amd64,linux/arm64` baut und nach `ghcr.io/hpmartini/…` mit Tag `<version>` pusht; `latest` nur bei nicht-Pre-Releases. | `actionlint` grün auf den Workflow-Dateien; Diff-Ausschnitt der Tag-Logik im PR                                                                                                |
| AC-2 | Beide Images bauen für beide Architekturen.                                                                                                                                                                                | PR-CI-Job (oder lokal `docker buildx build --platform linux/amd64,linux/arm64` ohne Push) grün, Log-Auszug im PR                                                               |
| AC-3 | Die Release-Compose-Datei startet die Stack ohne Repo-Checkout aus GHCR-Images: api, frontend, db, redis werden healthy, `GET /api/health` über den Frontend-Port liefert 200.                                             | Skript in leerem Temp-Verzeichnis mit lokal gebauten, auf die GHCR-Namen getaggten Images: `docker compose -f <release-compose> up -d`, Health-Check per `curl`, Ausgabe im PR |
| AC-4 | Der Workflow hängt die Release-Compose-Datei (plus nötige Begleitdateien) als Asset ans Release.                                                                                                                           | Workflow-Diff; echter Lauf: offen bis zum nächsten Release durch Hape, dann `gh release view <tag> --json assets`                                                              |
| AC-5 | Images landen tatsächlich in GHCR und sind anonym ziehbar.                                                                                                                                                                 | offen, weil erst ein von Hape veröffentlichtes Release den Push auslöst; danach `docker logout ghcr.io && docker pull ghcr.io/hpmartini/<image>:<version>`                     |
| AC-6 | Doku (`README.md` Docker-Abschnitt, `DESKTOP.md` verlinkt) beschreibt in ≤ 15 Zeilen: Desktop-Installer aus Releases, Docker-Stack per Release-Compose, PTY-Host als Voraussetzung, `.env`-Variablen.                      | Abgleich der Doku-Schritte gegen das AC-3-Skript                                                                                                                               |
| AC-7 | Bestehende Tests und Lint unverändert grün.                                                                                                                                                                                | `bun run test:run` und `bun run lint` Ausgabe                                                                                                                                  |

Stopp-Regel: weiterarbeiten bis AC-1–4, 6, 7 belegt sind; nur abbrechen bei fehlendem Docker/buildx in der Umgebung (dann AC-2/AC-3 als offen mit Grund melden). Rückmeldung: PR mit `## Nachweise` je AC.

## Ambition

- Altitude: Statt Compose + Host-PTY-Host ein Image, das alles enthält; nur Vorschlag, nicht Scope.
- Depth: `docker/build-push-action` mit `docker/metadata-action` (OCI-Labels inkl. `org.opencontainers.image.source`, damit das Paket ans Repo gebunden ist), GHA-Build-Cache; Ziel: Docker-Job ≤ 15 min pro Release.
- Crew: tut, was ein Sicherheitsprüfer tut: prüft, dass weder `.env` noch `data/` im Build-Kontext landen (`.dockerignore`) und dass das Release-Compose den Docker-Socket nur optional mountet.

## Prüfung

langlebig · unabhängig · Release-Infrastruktur, die jedes künftige Release trägt, mit `packages: write`-Token und öffentlich gezogenen Images; `mw:reviewer` prüft Workflow-Diff und Release-Compose gegen diesen Vertrag.

## First on approval

Worktree von `origin/main` anlegen und `Dockerfile.api`/`Dockerfile.frontend` lokal mit `docker buildx` für beide Plattformen bauen, um zu sehen, ob arm64/amd64 (node-pty-Rebuild) ohne Änderungen durchläuft.

## Annahmen

- Electron-Teil des Issues gilt durch `release.yml` und rc4–rc7 als erledigt; Windows bleibt draußen (seit 87080c1 entfernt). (vorgeschlagen)
- Images: zwei, `devhub-api` und `devhub-frontend` (Namen frei wählbar, aber lowercase, Repo-Name als Präfix). (vorgeschlagen)
- `code-server` bleibt im Release-Compose optional (Profil o. ä.), weil es ein Pflicht-Passwort verlangt und für den Kern nicht nötig ist. (vorgeschlagen)
- GHCR-Pakete erben die Sichtbarkeit des öffentlichen Repos; falls sie nach dem ersten Push privat sind, stellt Hape sie einmal auf public. (vorgeschlagen)
- Der alte Bot-Branch `claude/issue-35-20260110-0828` wird nicht verwendet, weil die Codebasis seitdem weit abgewichen ist. (vorgeschlagen)
