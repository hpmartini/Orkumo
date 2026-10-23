# DevOrbit Leitbild: ADE (Agentic Development Environment)

> Quelle der Wahrheit für alle Menschen und Agenten, die an DevOrbit arbeiten. Bei Widerspruch gewinnt dieses Dokument; Änderungen nur durch Hape.

## Ziel

**DevOrbit ist Hapes komplette Arbeitsumgebung für agentische Entwicklung.** Issues planen, Agents steuern, Code editieren, Terminals nutzen, über alle Geräte hinweg, ohne die Anwendung zu verlassen.

Features entstehen nicht als getrennte Inseln (Agents-Liste, Board, Mesh, Web-IDE), sondern als Modi derselben Umgebung, verbunden über den **Kontext**.

## Kernobjekt: der Kontext

Ein Kontext bündelt zusammengehörige Dinge:

```
Issue ↔ Agent(en) ↔ Worktree/Branch ↔ Pull Request ↔ Code
```

- Jeder Modus zeigt die „zugehörigen Dinge“ des aktuellen Kontexts (am Issue: die Agents, die daran arbeiten; am Agent: seine Issues, sein Worktree, sein PR).
- Ein Klick springt in den passenden anderen Modus und **behält den Kontext** (Agent → Terminal desselben Worktrees, Issue → Board-Karte, PR → Code-Diff).
- Verknüpfungen werden abgeleitet, nicht manuell gepflegt: `mw-board`-Kommentar mit Session-ID am Issue, PR-Links in `~/.claude/jobs/<id>/state.json`, „Closes #n“ im PR, Worktree/Branch der Session.

## Modi

Alle Modi leben unter **einer einheitlichen Shell/UI** (gemeinsame Navigation, Sidebar, Command-Palette, Kontext-Leiste).

| Modus     | Zweck                                                                                                   | Heute                               |
| :-------- | :------------------------------------------------------------------------------------------------------ | :---------------------------------- |
| Überblick | Projekte, Agents, Issues, PRs, Board-Status auf einen Blick                                             | Dashboard (Projekte, Ports, Alerts) |
| Board     | GitHub-Projects-Spiegel (Default: MACC), Issues planen, Karten per Drag & Drop setzen den GitHub-Status | #44                                 |
| Agents    | Laufende Agents sehen, starten, im Terminal anweisen                                                    | `/agents` (AgentsView)              |
| Code      | VS-Code-Server/Web-IDE aller Projekte                                                                   | CodingView, WebIDEPanel             |
| Terminal  | Web-Terminal mit Tabs, inkl. Claude-Code-Tabs                                                           | XTerminal, Details-Ansicht          |

## Mesh

- Alle Geräte sind verbunden: Mesh = bestehendes **Tailscale-Tailnet**, kein neues P2P-Protokoll.
- Agents laufen **auf ihrem Gerät** weiter. Remote nur **ansehen/steuern** oder per **SSH-Terminal anhängen** (`ssh <host> claude agents --json`, Attach per `ssh -t <host> claude attach <id>`). **Keine Session-Verlagerung.**
- DevOrbit muss remote nicht laufen; kein DevOrbit-Port wird ins Netz geöffnet.
- v1: Liste + Attach + Logs. Stop/Reply/Dispatch remote später.

## Prinzipien

1. **Kontext vor Feature.** Jedes Feature sagt, welche Kontext-Verknüpfung es liest oder schreibt.
2. **Ein Klick zwischen Modi, Kontext bleibt.** Kein Modus ist eine Sackgasse.
3. **GitHub ist Quelle für Issues/PRs/Board**, DevOrbit spiegelt und schreibt zurück (Status), speichert keine zweite Wahrheit.
4. **Eine Shell.** Neue Ansichten nutzen die gemeinsame Navigation und Komponenten, keine eigenen Layouts.
5. **Nur unmodifizierte `claude`-CLI**, kein Token-Auslesen, keine Umgehung (siehe `briefings/2026-10-22-cloud-remote-sessions.md`). Gilt auch für Mesh.
6. **Lokal zuerst.** Agents und Daten bleiben auf dem Gerät, das sie erzeugt hat.
7. **Offene Entscheidungen gehören Hape** (`need-input`), Agents erfinden keine Leitbild-Entscheidungen.

## Roadmap-Reihenfolge

Epics (GitHub `hpmartini/DevHub`, Board MACC = users/hpmartini/projects/4):

| #   | Säule               | Inhalt                                                    | Issues        |
| :-- | :------------------ | :-------------------------------------------------------- | :------------ |
| 1   | Kontext-Verknüpfung | Issue ↔ Agent ↔ Worktree ↔ PR ableiten und anzeigen       | Basis für 2–5 |
| 2   | Board               | GitHub-Projects-Spiegel, Slices, Swimlanes, Drag & Drop   | #44           |
| 3   | Agents/Mesh         | Agents-Liste verfeinern, Remote-Agents über SSH/Tailscale | #45–#56, #57  |
| 4   | Code-Modus          | Web-IDE/VS-Code-Server aller Projekte, Kontext-Sprung     | CodingView    |
| 5   | Einheitliche Shell  | Gemeinsame Navigation, Kontext-Leiste, Modus-Wechsel      | übergreifend  |

Reihenfolge: 1 zuerst (Voraussetzung für Kontext-Sprünge), dann 2 und 3 parallel, 4 und 5 nachziehen, sobald Board und Agents die Kontext-Leiste brauchen.

## Für Agents

- Vor Arbeit an einem Issue: Welche Säule? Welcher Kontext wird gelesen/geschrieben?
- Ändere nichts am Leitbild; bei Widerspruch zwischen Issue und Leitbild stelle eine Rückfrage (`need-input`).
- Briefing-Format für Agents: Leitbild-Satz + was daraus für das Issue folgt + Link auf dieses Dokument.
