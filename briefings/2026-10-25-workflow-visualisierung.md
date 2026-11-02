# Briefing: Workflow-Visualisierung für Martini Workflows (mw) – Issue #87

## The Job

In DevOrbit gibt es einen neuen Modus **Workflows** (Route `/workflows`, in der gemeinsamen Shell/Navigation). Er zeigt die Workflows des mw-Plugins (`~/.claude/plugins/cache/martini-labs/mw/<version>`, Repo `hpmartini/example-workflow-plugin`) als animierte Stufen-Strecke, mit allen Issues, die gerade durch einen Workflow laufen, in ihrer aktuellen Stufe:

- **Abstrahierte Stufen** (eine gemeinsame Strecke, Modus als Badge): _Freigegeben_ (Todo, `mw:go`) → _Briefing/Plan_ (Abgeholt, Interview, `need-input`) → _Wartet auf GO_ (`briefed`-Marker ohne `mw:build`, Pipeline-Approval briefing/plan) → _Umsetzung_ (build/gates/review/repair aus `trace.jsonl`) → _Review_ (PR offen, MACC „to Review") → _Fertig_ (Done/to Deploy). Modi: default, orchestrate, pipeline.
- **Animation**: three.js-Szene als Strecke/Hintergrund; ein Issue, dessen Stufe sich seit dem letzten Abruf geändert hat, fliegt sichtbar in die neue Stufe.
- **Hover-Overlay**: Titel, Repo#Nr, Stufe, Modus, seit wann, wartet auf wen.
- **Aufklappbar** (Drop-down an der Karte): laufende Prozesse/Phasen (Trace-Einträge, aktive Session), zugehörige Dokumente (`briefings/*.md`, PLAN, PRD aus dem Worktree), Review-Screenshots (Bilder in PR-Kommentaren/Run-Ordner), Links zu Agent (`/agents`, Session aus `mw-board:start`-Marker), Issue, PR, Code (CodingView/Web-IDE mit dem Worktree).
- **GO-Knopf** pro Karte, wenn die nächste Stufe Hapes Freigabe braucht: Label `mw:build` setzen (default-Modus nach Briefing) bzw. `mw approve --repo … <run> briefing|plan|pr <sha>` (Pipeline).

## Why

Hape steuert seine Entwicklung über mw board/MACC und will an einem Ort sehen, was in welchem Workflow wo hängt, und mit einem Klick freigeben oder in Agent, PR oder Code springen. Das ist Leitbild-Säule 1/2 (Kontext Issue ↔ Agent ↔ Worktree ↔ PR ↔ Code, `docs/VISION.md`): die Ansicht liest diese Verknüpfungen und ist keine Sackgasse.

## Guardrails

- Datenquellen wiederverwenden: `server/services/boardService.js` (MACC-Items, `mw-board`-Marker, PRs), `agentContextService.js`, `agentService.js`; neu nur das Lesen von `<clone>/.git/mw6/runs/*/{state.json,trace.jsonl}`. Stufen-Ableitung als reine, unit-getestete Funktion (Muster: `utils/agentSessions.ts`).
- Schreibend nur die GO-Aktionen; Freigabe-Berechtigung wie mw (`[approval] approvers`). Kein Merge, weil mw nie merged.
- Nur unmodifizierte `gh`/`claude`/`mw`-CLI aufrufen (Leitbild Prinzip 4); keine Plugin-Interna importieren, weil die Plugin-Version wechselt.
- Neue Deps erlaubt: `three` und `motion` (für Aceternity-Komponenten). Szene lazy laden, `prefers-reduced-motion` respektieren, ohne WebGL eine statische Ansicht.
- Design mit `/impeccable`; Aceternity-UI-Komponenten über den Skill `/demo-skills:aceternity-ui` einbauen, weil er die passenden Komponenten und deren Einbau für dieses Setup kennt.
- Annahme: „Reviews approven" = mw-Approvals (`mw:build`, `mw approve … pr`), nicht GitHub-PR-Review, weil Hape eigene PRs nicht approven kann.
- Annahme: Nur lokale Clones; Remote/Mesh-Hosts später.
- Annahme: Aktualisierung per Polling wie das Board (kein neuer Push-Kanal).
- Out of scope: Workflows bearbeiten, mw-Plugin ändern, Board-Modus umbauen.

## Done means

- `/workflows` zeigt reale MACC-Issues in der richtigen Stufe; Check: Unit-Tests der Stufen-Ableitung mit Fixtures je Modus und Stufe (`bun run test` grün), `bun run lint` und `bun run build` grün.
- Browser-Nachweis (Playwright): Screenshot der Strecke, Hover-Overlay, ausgeklappte Karte, Stufenwechsel-Animation; GO-Knopf gegen ein Test-Issue setzt `mw:build`.
- Unverändert: Board-, Agents- und Coding-Modus funktionieren wie zuvor.
- PR gegen `main` mit `Closes https://github.com/hpmartini/DevHub/issues/87` und `## Review-Anleitung`. Weiterarbeiten, außer bei fehlenden Rechten/Scopes für GitHub-Schreibzugriffe.
- Rückmeldung: kurze Bullets – was gebaut, wo, getroffene Annahmen, offene Punkte.

## First on approval

Die reine Funktion „Issue + Marker + Labels + Run-Trace → Stufe" mit Fixtures schreiben; Server-Route und UI bauen darauf auf.
