# Übergabe Status-Ansicht (UI-Teil), 2026-11-20

Vertrag: `briefings/2026-11-19-lage-ansicht.md` (verbindlich, Annahmen übernommen). Prototyp:
`briefings/mockups/lage-prototyp.html`, Screenshots `briefings/assets/lage/`. UI nur mit `/impeccable`.

## Fertig

- Orkumo `feat/lage-ansicht` (Worktree `.claude/worktrees/lage-ansicht`):
  - `server/services/orchestratorReports.js`: Speicher (`<data>/orchestrator/reports/<id>.json` + `changes.jsonl`), Absender-Prüfung (AC-3), Stale-Regel mit festgehaltenem ersten Ereignis + 60-s-Timer (AC-5), neue Entscheidungen → macOS-Mitteilung über osascript (AC-6), Antwortweg wie `orkumo send` (AC-4).
  - Routen in `server/index.js`: `POST /api/orchestrator/reports`, `GET /api/orchestrator/reports` (`{reports:[{report, receivedAt, answers, stale, firstEventAt}], changes}`), `POST /api/orchestrator/reports/:id/answers` (`{entry, option?, text?}`; 404 kein Eintrag, 409 nicht erreichbar).
  - CLI `orkumo report <file|->`, Regeln in `server/orchestrator/agents.md` + `skill.md`; Schema/Beispiel liegen neben der CLI.
  - Tests: `test/orchestratorReports.test.js`, `test/orchestratorReportCli.test.js` (echter Server zweimal, echte CLI, nur `claude` als Stub).
  - agents-ui auf PR-Kopf `5fdd7de` gepinnt (Haken `renderPaneActions`, hpmartini/agents-ui#6).
- DevHub-pro `feat/status-view` (Worktree `.claude/worktrees/status-view`): `src/status/index.js` (Modus „Status“, Icon `Layers`, Route `GET /api/modules/status/board` → Issue-URL → Stufe/Spalte über Workflow-Provider), `src/status/macc.js` (`boardStates`, `statesFor`), `test/statusBoard.test.js`.

## Offen (in dieser Reihenfolge)

1. `src/status/ui.js` in DevHub-pro nach Prototyp (For you mit Projekt-Spalte, Projects, Orchestrators; loading/error/empty). Daten: `${host.apiBase}/orchestrator/reports` und `${host.apiBase}/modules/status/board`; Filter aus `host.search` (`?orchestrator=<id>`). Build-Einträge in `package.json` (`esbuild src/status/index.js` + `src/status/ui.js` → `dist/status/`) und `scripts/write-module-package.js` (`'status'`).
2. AC-9 Knopf: Orkumo `App.tsx`/`components/AgentsHost.tsx` setzt `renderPaneActions`; Knopf „Show in Status“ nur bei `pane.orchestrator` und nur, wenn ein Modul den Modus deklariert (Vorschlag: Mode-Flag `orchestratorFilter: true` in `moduleLoader.parseMode` + `hooks/useModules.ts` + `docs/MODULES.md`). Ziel: `/<modeId>?orchestrator=<role ?? session.id>` (gleicher Schlüssel wie `authorizeReporter`). Ohne Modul: nichts (AC-7).
3. Browser-Prüfung + Screenshots/GIF (ui: on), AC-4 echter Lauf (Antwort kommt im Orchestrator-Pane an) – App-Install/Neustart nur nach Hapes Ja.
4. `mw:reviewer` (nur Vertrag + Diff), PRs Orkumo + DevHub-pro, Woodpecker grün, nicht mergen; agents-ui#6 nach Merge als v0.4.5 taggen (`git fetch --tags` vorher), dann Pin auf `#v0.4.5`.
5. Bericht an playmaker.

## Fallstricke

- Worktree-`node_modules` ist echt installiert (der alte Symlink war kaputt). DevHub-pro: `bun install --frozen-lockfile` erledigt.
- Ein Hook blockiert Heredocs, die das Wort `export` enthalten: Dateien mit Write anlegen.
- Auf `main` schon rot (nicht von uns): `test/boardWriteRoutes.test.js` (2), `test/remoteSetting.test.js` (1).
- impeccable: `.claude/settings.local.json` liegt im Worktree (Kopie aus dem Hauptklon, nicht committen); lädt erst in neuer Session.
- Grenze AC-5: gemergte PRs sieht die Übersicht nicht (nur „worker fertig“); Turn, der bei gestopptem Server begann und endete, fehlt. Steht als `shortcut:` im Code.
- Offene Frage: Meldungen von Orchestratoren ohne Rolle (Schlüssel = Agent-ID) bleiben liegen, wenn die Session endet; kein Löschweg gebaut.
