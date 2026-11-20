---
version: 1
slug: 'briefings-mockups-lage-prototyp-html'
primary_target: 'briefings/mockups/lage-prototyp.html'
related_targets: []
---

# Surface: Lage (Orkumo Pro mode)

Mode: Operate. Scope: the "Lage" work mode (prototype now: briefings/mockups/lage-prototyp.html; later the Pro module in DevHub-pro). Inherits the app world (Ghostty blue gray scale, Inter, lucide, cursor accent #8fd0ff), not the landing DESIGN.md.

Audience/job: Hape, several times a day, between agent sessions: see what needs him, act in place, check that nothing is stuck. Constraints: neutral sample data only (public repo), English UI copy (owner decision 2026-11-20), dark app shell.

## Direction contract

THESIS: A work queue, not a dashboard. What needs Hape is a short ordered list he clears top-down with one click per item; everything else is a quiet, collapsible ledger below. Refuses the category default of metric tiles plus kanban columns.

OWN-WORLD: The app's blue-tinted gray scale on 900/850 surfaces, 1px gray-700 hairlines, white text for what needs action, gray-400 for the rest. One accent: cursor blue for focus and the recommended option. State is shape plus word: rose hollow ring (wartet auf dich), amber half ring (läuft), emerald dot (fertig), dotted ring (geplant), struck ring (abgebrochen). Mono only for repo, #numbers and ids.

STORY: Hape opens Lage, reads "3 für dich", answers the top decision with the recommended option, approves a PR with the two-step button, ticks a to-do; each row turns into an "beantwortet" stub until the orchestrator's next report closes it. Below, he expands a project to see which task is stuck and which orchestrator is stale.

FIRST VIEWPORT: activity bar left (Lage active), orchestrator rail (w-72) with freshness per orchestrator and the filter, main column max 960px: header line "Lage" + filter chip + "zuletzt gemeldet"; "Für dich" list with the top decision expanded and its options as buttons; first two projects of the ledger visible below the fold line.

FORM: Inbox list over collapsible ledger, position 1 of 1 (structure pinned by the briefing: inbox on top, collapsible project list, no kanban). seed: none (pinned) "Oben der Eingang „Für dich“, nach Dringlichkeit sortiert. Darunter die Projekte als aufklappbare Liste mit Aufgaben, kein Kanban." Signature interaction: answered row collapses into a stub that carries who must close it.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
