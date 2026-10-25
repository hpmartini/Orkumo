# Briefing: Code-Modus (Epic #61)

## The Job

DevOrbit hat einen eigenen Modus **Code** (Route `/code`, Eintrag in der Sidebar neben Agents und Board). Er öffnet die vorhandene Web-IDE (code-server im iframe, `WebIDEPanel`) für jedes gescannte Projekt und jeden Agent-Worktree, nicht nur aus der Details-Ansicht einer App. Ein Projekt-/Worktree-Wähler steht oben; der gewählte Ordner steht in der URL (`/code?path=<abs>`), damit Reload und Links funktionieren.

Aus dem Kontext springt man mit einem Klick hinein und der Ordner stimmt:

- Agent (AgentsView, Zeile/Peek): Worktree der Session (`AgentContext.repo.worktreePath`, sonst Session-cwd).
- Issue (BoardView, Karte/Panel): Worktree des verknüpften Agents, sonst Repo-Pfad (`fetchRepoPath` in `services/boardApi.ts`).
- PR (Agent-Kontext `pulls.items`): Worktree des PR-Branches, falls lokal vorhanden; Diff liefert die SCM-Ansicht von code-server.

## Why

Ich (Hape) baue DevOrbit zu meiner ADE aus (docs/VISION.md, Säule 4). Kernobjekt ist der Kontext Issue ↔ Agent ↔ Worktree/Branch ↔ PR ↔ Code; "Code" ist heute eine Sackgasse in der App-Details-Ansicht. Danach soll ich von jedem Agent oder Issue ohne Suchen im Code des richtigen Worktrees landen und zurückspringen können.

## Guardrails

- Wiederverwenden: `components/CodingView/WebIDEPanel.tsx` (code-server-Start, `?folder=`), `/api/code-server/*` in `server/index.js`, `hooks/useAgentContexts.ts`, Navigation wie `/agents` und `/board` in `App.tsx`/`components/Sidebar.tsx`, weil das Leitbild eine Shell verlangt (Prinzip 3).
- Eine code-server-Instanz für alle Ordner; Ordnerwechsel über die iframe-URL, weil mehrere Instanzen Ports und RAM kosten.
- Pfade aus URL/Client prüft der Server: nur Ordner unter den konfigurierten Scan-Verzeichnissen oder bekannte Agent-Worktrees, weil `?path=` sonst beliebige Ordner öffnet.
- Die bestehende Coding-Sub-View pro App (Terminals + IDE + Browser) bleibt unverändert funktionsfähig.
- Out of scope: Kontext-Leiste/Modus-Wechsel-Shell (#62), neue Ableitung von Issue↔Agent-Links (#58; nutze, was der Code schon ableitet), eigene Diff-Ansicht, Remote-Geräte (Mesh).
- Annahme: Modus = neue Route `/code`, nicht Erweiterung der App-Details-Ansicht.
- Annahme: Issue ohne verknüpften Agent springt ins Haupt-Checkout des Repos; ohne lokales Repo ist der Button deaktiviert mit Tooltip.
- Annahme: PR ohne lokalen Worktree des Branches öffnet das Haupt-Checkout; kein automatisches `git worktree add`.
- Annahme: Projektliste = gescannte Apps (`useApps`) plus Worktrees laufender Agents, gruppiert nach Repo.

## Done means

- `/code?path=<worktree>` zeigt code-server mit genau diesem Ordner; Reload behält ihn.
- Je ein Sprung aus Agent, Issue-Karte und PR landet im richtigen Ordner (Playwright-Lauf oder Screenshot je Sprung als Nachweis).
- Pfad außerhalb der erlaubten Wurzeln → Server antwortet 403, UI zeigt Fehler; Unit-Test dafür.
- Unit-Tests für die Pfad-Auflösung Agent/Issue/PR → Ordner (rein, wie `utils/agentSessions.ts`).
- `bun run build` und bestehende Tests grün; App-Details-Coding-View unverändert.
- Weiterarbeiten außer bei: code-server lässt Ordnerwechsel ohne Neustart nicht zu, oder Leitbild-Widerspruch → Rückfrage.
- Rückmeldung: PR mit `Closes #61`, kurzer Bericht was getan, welche Annahmen gegriffen haben.

## First on approval

`WebIDEPanel` lesen und prüfen, ob es ohne `AppConfig` mit einem reinen Ordnerpfad nutzbar ist; davon hängt ab, ob `/code` es direkt einbettet.
