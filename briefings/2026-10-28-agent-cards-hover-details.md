# Briefing: Agent-Cards – Details beim Hovern, aufgeräumte Darstellung, einstellbar

## The Job

In der Agent-Liste (`/agents`, Rail links) zeigen die Agent-Cards ihre Details (Issue-/PR-Pills, Server-Ports, Sub-Agents = `SessionLinks`) schon beim Hovern, nicht nur nach Klick auf den Pfeil. Die Card ist sichtbar aufgeräumter: klare Zeilen (Titel · Repo/Branch · Cache/Kontext · Details · Status-Text) mit mehr Luft und Trennung, statt der heutigen dichten Zeilen. Beides ist in den Agent-Einstellungen umstellbar.

## Why

Hape steuert viele parallele Agents über DevOrbit (ADE, siehe `docs/VISION.md`). Er will beim Überfliegen der Liste sofort sehen, an welchem Issue/PR/Port ein Agent hängt, ohne jede Card einzeln aufzuklappen. Die Card ist heute so voll, dass die wichtigen Infos (Name, Status, Kontextverbrauch, letzte Meldung) untergehen. Die Einstellung erlaubt, je nach Anzahl Agents zwischen ruhig/kompakt und informativ zu wechseln.

## Guardrails

- Code: `components/AgentsView/AgentList.tsx` (Session-Row ab „hasDetails“/„expanded“, ~Z. 700–900), `SessionLinks.tsx`, `CacheBadge.tsx`, `AgentSettingsPanel.tsx`. Settings über bestehende `AgentViewSettings` (`types.ts`), `DEFAULT_AGENT_VIEW_SETTINGS` (`server/services/settingsService.js`) und Zod-Schema `agentViewSettingsSchema` (`server/index.js`) – gleiches Muster wie `notifications`, damit es serverseitig persistiert.
- Neue Settings: `cardDetails: 'hover' | 'click' | 'always'` und `cardDensity: 'comfortable' | 'compact'`. Bestehender Klick-Toggle (`expandedSessions` in `hooks/useRailPreferences.ts`) bleibt und pinnt die Details auch im Hover-Modus.
- Design mit dem `/impeccable`-Skill erarbeiten (Hapes ausdrücklicher Wunsch); `.impeccable/config.json` liegt im Repo. Bestehende Farben/Tokens und Tailwind-Klassen weiterverwenden, kein neues UI-Framework.
- A11y: Details erscheinen auch bei Tastaturfokus der Card; Touch (`hover:none`) fällt auf Klick zurück. `motion-reduce` respektieren.
- Out of scope: Peek-Panel, Gruppen-Header, Board-/Workflow-Cards, Inhalt der Details (keine neuen Felder).
- Annahme: Default `cardDetails = 'hover'`, `cardDensity = 'comfortable'`.
- Annahme: Hover klappt inline auf (Card wächst), mit kurzer Verzögerung (~150–250 ms) gegen Flackern beim Durchfahren; kein Floating-Popover.
- Annahme: „Darstellung der Felder einstellbar“ = Dichte-Umschalter; keine Einzel-Ein/Aus-Schalter pro Feld.
- Max. 2 Subagenten.

## Done means

- Hover/Fokus auf eine Card mit Details zeigt `SessionLinks` ohne Klick (Modus `hover`); `click` verhält sich wie heute; `always` zeigt sie dauerhaft.
- Dichte-Umschalter sichtbar wirksam; `comfortable` ist laut Impeccable-Kritik nicht mehr „zu voll“ (Kritik-Ergebnis im PR zitieren).
- Beide Settings in `AgentSettingsPanel`, persistieren über Reload.
- Beleg: Unit-Tests für Settings-Defaults/Schema; `bun run build` + bestehende Tests grün; Vorher/Nachher-Screenshots (beide Modi, beide Dichten) im PR.
- Unverändert: Selektion, Doppelklick-Attach, Kontextmenü, Drag & Drop, Peek, Favoriten-Stern.
- Stopp nur bei Blockern, die Hapes Entscheidung brauchen. Rückmeldung: kurzer Bericht, getroffene Annahmen.

## First on approval

`/impeccable` auf die Session-Row in `AgentList.tsx` ansetzen (Kritik + Vorschlag für die aufgeräumte Card).
