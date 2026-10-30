# Briefing: Aktiven Tab/Pane im Agents-Rail markieren (VS-Code-Reveal) — DevHub#54

## The Job

Im Agents View (`/agents`) folgt die Markierung im linken Rail dem aktiven Workspace-Tab und dem aktiven Pane eines gekachelten Tabs: Die Zeile des zugehörigen Agents ist markiert, wird in den sichtbaren Bereich gescrollt, und ihre Gruppe (auch Favoriten) klappt bei Bedarf auf. Am Ende steht ein PR, der das belegt und `Closes https://github.com/hpmartini/DevHub/issues/54` trägt.

Stand auf `origin/main` (Commit `bf8bbe5`, „agents rail round 5", Refs #54): Der Kern ist schon da.

- `AgentsView.tsx` leitet `activeSessionId` aus `workspace.tabs`/`activeTabId` ab und reicht `onRevealActive={(id) => rail.revealSession(groups, id)}` an `AgentList`.
- `AgentList.tsx` (Effekt „Reveal the workspace's active session") scrollt die Zeile per `scrollIntoView({block:'nearest'})` oder fordert das Aufklappen an; Zeile bekommt `aria-current` und `outline-blue-400`, Gruppenkopf `groupHasActive`.
- `useRailPreferences.ts` `revealSession` klappt Ursprungs- und Favoritengruppe auf.
- `AgentWorkspace.tsx` meldet Pane-Fokus über `onFocusPane`.

Die Aufgabe ist daher: Abnahme gegen die Kriterien prüfen, Lücken schließen, Verhalten mit Tests absichern.

## Why

Hape arbeitet mit vielen parallelen Agents in Tabs und Kacheln (Säule „Agents und Mesh", Epic #60, Sammelissue #45; Leitbild `docs/VISION.md`). Er muss beim Tab-/Pane-Wechsel sofort sehen, welcher Agent das im Baum ist, ohne zu suchen, wie „Reveal in Explorer" in VS Code. Die Markierung darf dabei nie den Fokus aus dem Terminal ziehen.

## Guardrails

- Scope: `components/AgentsView/AgentList.tsx`, `AgentsView.tsx`, `AgentWorkspace.tsx`, `hooks/useRailPreferences.ts`, `hooks/useAgentWorkspace.ts`, Tests unter `test/` bzw. neben `utils/`. Andere Rail-Themen aus #45 (#46–#56) nur anfassen, wenn sie die Markierung direkt betreffen.
- Kein Fokuswechsel durch Reveal: nur scrollen und markieren, weil Tastatureingaben im Terminal sonst verloren gehen.
- „Bestehende Fokus-Zonen-Darstellung" nutzen: Farben/Klassen aus `selectedClass`, `useAgentFocusZone` und den vorhandenen `outline`-Stil wiederverwenden, keinen neuen Stil erfinden.
- Manuelles Zuklappen respektieren: Reveal klappt nur beim Wechsel des aktiven Agents auf, nicht dauerhaft bei jedem Render (heutige `revealed`-Ref-Logik beibehalten).
- Pure Logik (z. B. Gruppen-Key-Ermittlung) in testbaren Funktionen halten, wie `utils/agentSessions.ts` / `test/railPreferences.test.ts`.
- Branch `macc/45` (gemeinsam mit Geschwister-Issues; existiert er auf origin, darauf weiterarbeiten und PR ergänzen), eigener Worktree unter `.claude/worktrees/`, Basis `origin/main`. PR gegen `main`, kein Merge.
- Annahme: „Panel" im Issue meint ein Pane in einem gekachelten Tab, nicht die Seitenpanels (PRs, Settings).
- Annahme: Bei aktiver Quick-Filter-/Textfilterung, die den Agent ausblendet, wird nicht markiert und kein Filter aufgehoben.
- Annahme: Steht der Agent in Favoriten und Ursprungsgruppe, reicht Markierung beider Zeilen; gescrollt wird zur ersten sichtbaren.
- Annahme: Remote-Agents (`RemoteAgents.tsx`) sind nicht Teil dieses Issues.

## Done means

- Tab-Wechsel (Klick, Shortcut) und Pane-Wechsel (Klick/Fokus in Kachel) markieren den passenden Agent; Zeile sichtbar; eingeklappte Gruppe öffnet sich; Terminal behält den Fokus.
- Beleg: `bun run test` grün inkl. neuer Tests für die Reveal-Entscheidung (Gruppe einklappen → Wechsel → aufgeklappt; Pane-Wechsel ändert `activeSessionId`); `bun run build` und `bunx tsc --noEmit` ohne neue Fehler. Zusätzlich manuell im laufenden Dashboard geprüft (Playwright oder Chrome), Screenshot im PR.
- Unverändert: Klick-/Doppelklick-Verhalten der Rail-Zeilen, Gruppen-Reihenfolge, Favoriten, Fokus-Zonen-Shortcuts.
- Stopp-Regel: durcharbeiten; nur stoppen, wenn sich zeigt, dass „Panel" doch Seitenpanels meint und das den Umfang verdoppelt.
- PR-Body: `Closes https://github.com/hpmartini/DevHub/issues/54`, Abschnitt `## Review-Anleitung` (Start `bun run dev`, `/agents`, zwei Tabs + gekachelter Tab, Gruppe zuklappen, wechseln). Rückmeldung: kurz, was geändert, was nur verifiziert, welche Annahmen gegriffen haben.

## First on approval

`git fetch origin` und Worktree auf `macc/45` (bzw. neu von `origin/main`) anlegen, dann im Dashboard die drei Kriterien gegen den Ist-Stand von `bf8bbe5` durchspielen, um die echten Lücken zu kennen.
