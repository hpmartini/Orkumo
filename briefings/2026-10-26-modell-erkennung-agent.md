# Briefing: Modell-Erkennung pro Agent (#56)

## The Job

Die Kopfzeile im Agents-View (`components/AgentsView/AgentsView.tsx:1358-1366`, Label `model …` rechts oben) zeigt für den aktiven Agent immer das Modell, das tatsächlich läuft, sobald es feststellbar ist, und nie das Dispatch-/User-Default als wäre es das Modell des Agents. Beispiel aus dem Issue: Agent läuft mit Opus 5.5, Anzeige zeigt Sonnet.

## Why

DevOrbit ist Hapes Arbeitsumgebung für agentische Entwicklung (docs/VISION.md, Säule Agents und Mesh, Epic #60 → #45). Hape steuert viele parallele Agents (mw board startet sie mit `--model claude-opus-5-5`, während `~/.claude/settings.json` `model: "sonnet"` setzt). Eine falsche Modellanzeige führt zu falschen Entscheidungen über Kosten, Effort und welchem Agent er was anvertraut.

## Guardrails

- Stand im Code (Commit bf8bbe5, nach dem Issue entstanden): `parseModelFromTranscript` + `sessionModel` in `server/services/agentContextService.js:126-185` lesen das Modell aus dem Transkript-Tail (letzter Main-Thread-Assistant-Eintrag, Sidechain/`<synthetic>` ignoriert), `formatModelName` in `utils/agentSessions.ts:296`, Tests in `test/agentContextService.test.js` und `test/agentSessions.test.ts`. Darauf aufbauen, nicht neu bauen.
- Wahrscheinliche Restlücken (zuerst belegen, dann beheben): (1) Solange `contexts[id].model` null ist (vor der ersten Antwort, Kontexte noch nicht geladen, Transkript nicht gefunden), fällt die Kopfzeile auf `default: sonnet` aus User-Settings zurück. (2) `sessionModel` rät den Transkriptpfad nur über Slug von `cwd`/`worktree`; der Job-State liefert den echten Pfad (`state.linkScanPath` → `transcriptPath` in `agentService.js:595`). (3) Der Startparameter `--model` steht in `respawnFlags` und ist ein besserer Fallback als das Default. (4) Kontexte pollen alle 30 s (`hooks/useAgentContexts.ts`), ein Modellwechsel erscheint also verzögert.
- Annahme: Reihenfolge Transkript → `--model` aus `respawnFlags` → Dispatch-Default nur wenn kein Agent offen ist bzw. ausdrücklich als „default“ gekennzeichnet.
- Annahme: 30-s-Verzögerung beim Modellwechsel ist akzeptabel; nur verkürzen, wenn es mit vorhandenen Events (`agentEvents`) billig geht.
- Annahme: Interaktive (nicht-bg) Sessions bekommen dieselbe Transkript-Logik; ohne `respawnFlags` greift dort nur das Transkript.
- Out of scope: Effort-Anzeige, Remote-/Cloud-Agents, Dispatch-Settings-UI, Rail-Badges außer sie nutzen dieselbe Funktion.
- Branch `macc/45` (gemeinsam mit Geschwister-Issues), PR #89 ergänzen, Worktree unter `.claude/worktrees/`.

## Done means

- Kopfzeile zeigt für einen mit `--model claude-opus-5-5` gestarteten Agent „Opus 5.5“, auch vor der ersten Antwort und obwohl User-Default `sonnet` ist.
- Unit-Tests mit Session-Daten (Transkript-Fixtures/Job-State): reiner Opus-Lauf, reiner Sonnet-Lauf, Wechsel Opus→Sonnet mitten in der Session (letzter gewinnt), Transkript fehlt → `--model`-Fallback, Sidechain-Eintrag mit anderem Modell ändert nichts. `bun test` (bzw. Projekt-Testbefehl) grün, Ausgabe im Bericht.
- Manueller Beleg im laufenden Dashboard (`/agents`) mit einem echten bg-Agent, Screenshot im PR.
- Bestehende Tests unverändert grün.
- PR-Body: Zeile `Closes https://github.com/hpmartini/DevHub/issues/56`, Abschnitt `## Review-Anleitung`. Bericht kurz: getan, angenommen, offen.

## First on approval

Mit dem laufenden Job-State dieses Agents (`~/.claude/jobs/<id>/state.json`) und `GET /api/agents/context` nachweisen, welcher der vier Lückenpunkte die Sonnet-Anzeige tatsächlich verursacht.
