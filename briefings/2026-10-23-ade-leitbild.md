# Briefing: DevOrbit als ADE (Agentic Development Environment): Leitbild verankern

## The Job

Das Leitbild „DevOrbit ist Hapes komplette Arbeitsumgebung für agentische Entwicklung“ steht verbindlich im Repo, und alle laufenden Agenten arbeiten ihre Teilziele danach ab. Am Ende existieren:

1. **`docs/VISION.md`** (Quelle der Wahrheit, kurz): Ziel, Kernobjekt, Modi, Prinzipien, Roadmap-Reihenfolge.
   - Kernobjekt ist der **Kontext**: Issue ↔ Agent(en) ↔ Worktree/Branch ↔ Pull Request ↔ Code. Jeder Modus zeigt „zugehörige Dinge“ und springt per Klick in den passenden anderen Modus, ohne den Kontext zu verlieren.
   - Modi unter einer einheitlichen Shell/UI: Überblick (Projekte, Agents, Issues, PRs, Board-Status), Board (GitHub-Projects-Spiegel, Issues planen), Agents (laufende sehen, starten, im Terminal anweisen), Code (VS-Code-Server/Web-IDE aller Projekte), Terminal.
   - Mesh: alle Geräte verbunden, Agenten laufen auf ihrem Gerät weiter, Remote nur steuern/ansehen oder per SSH-Terminal anhängen, keine Session-Verlagerung.
2. **`CLAUDE.md` und neues `AGENTS.md`**: je ein kurzer Abschnitt „Leitbild“ mit Link auf `docs/VISION.md`. `AGENTS.md` verweist auf `CLAUDE.md`, damit beide Agent-Familien dasselbe lesen. `README.md` bekommt den Vision-Absatz; `IMPLEMENTATION_PLAN.md` die Roadmap-Tabelle.
3. **GitHub (`hpmartini/DevHub`, Board MACC = users/hpmartini/projects/4)**: Epics für die Säulen (Kontext-Verknüpfung, Board, Agents/Mesh, Code-Modus, einheitliche Shell), bestehende Issues (#44, #45, #57, #46–#56 u. a.) als Sub-Issues zugeordnet, je Issue ein kurzer „Einordnung ins Leitbild“-Absatz.
4. **Agenten-Briefing**: Jeder laufende Agent im Repo bekommt per `SendMessage` nur seine Scheibe: Leitbild-Satz + was für sein Issue daraus folgt + Link auf `docs/VISION.md`. Aktuell: Session `MACC DevHub#44 Agent Task Board` (6259550d) und `MACC DevHub#57 Mesh-Net` (c0fdf0a2).

## Why

Hape will seine gesamte Arbeit in DevOrbit erledigen: Issues planen, Agents steuern, Code editieren, über alle Geräte hinweg. Bisher entstehen Features (Agents-Liste, Board, Mesh) als getrennte Inseln; ohne gemeinsames Leitbild bauen die Agenten sie nicht zusammenpassend. Das Leitbild und die Kontext-Verknüpfung sind der rote Faden, an dem jeder Teil-Agent seine Entscheidungen ausrichtet.

## Guardrails

- Nur Doku, Issues und Agent-Nachrichten. Kein Feature-Code, keine Änderungen in `components/`, `server/`, `hooks/`.
- Vor jeder Dateiänderung `git status`/`git diff`; uncommittete Änderungen anderer Agenten erhalten (Worktree `agents-ui-redesign` ist gesperrt, nicht anfassen). Änderungen committen, nicht pushen.
- Agent-Nachrichten kurz und aufgabenbezogen: #44 bekommt Board/Kontext-Verknüpfung, #57 Mesh/SSH. Keine Instruktion, die der Nutzer nicht schon im Leitbild gesagt hat; neue Entscheidungen erfinden verboten.
- Subagenten: höchstens 2, nur für breite Suche im Repo.
- Projekte außerhalb DevOrbit (Maple, MindApp, demo-advisor, session-tracker) und deren Agenten nicht anfassen.
- Annahme: Mesh = bestehendes Tailscale-Tailnet, Transport SSH (`ssh <host> claude agents --json`, Attach per `ssh -t`), kein neues P2P-Protokoll. Das entspricht den offenen Rückfragen in #57.
- Annahme: Die offenen Rückfragen in #44 und #57 beantwortet der Agent gemäß Leitbild, wo es eindeutig ist (#44: Karten per Drag & Drop setzen den GitHub-Status = schreibend; Board MACC als Default; #57: Liste + Attach + Logs in v1, Stop/Dispatch remote später). Alles Offene bleibt `need-input`.
- Annahme: Alte Review-Dump-Issues (#12, #22, #23, #30, #31, #8, #20) bleiben unberührt; nur im Bericht als Aufräumkandidaten genannt.
- Datenschutz/ToS: Siehe `briefings/2026-10-22-cloud-remote-sessions.md`: nur die unmodifizierte `claude`-CLI, kein Token-Auslesen. Gilt auch für Mesh-Formulierungen.

## Done means

- `docs/VISION.md` ≤ 150 Zeilen; `CLAUDE.md`, `AGENTS.md`, `README.md`, `IMPLEMENTATION_PLAN.md` verweisen konsistent darauf (Check: `grep -l "VISION.md"` listet alle vier).
- `gh issue list` zeigt die Epics; jedes offene Feature-Issue (#44–#57) hat Parent und Leitbild-Absatz.
- Beide Agents haben die Nachricht erhalten (Zustellung per `ListAgents`/Tool-Ergebnis belegt).
- Unverändert: Code, Build und Tests (`bun run lint`, `bun run test` laufen wie zuvor).
- Rückmeldung: kurzer Bericht (Bullets): Dateien, Issue-Nummern, versandte Nachrichten, getroffene Annahmen, Aufräumkandidaten. Weiterarbeiten, außer bei einem Blocker, der Hapes Entscheidung braucht.

## First on approval

`docs/VISION.md` schreiben (Kontext-Objekt und Modi-Tabelle zuerst); alles andere leitet sich daraus ab.
