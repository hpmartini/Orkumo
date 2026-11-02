# Briefing: „New task“ – Verzeichnisauswahl liegt hinter dem Modal (Issue #132)

## The Job

Im Agents-View (`/agents`) öffnet der Ordner-Button im „New task“-Dialog die Verzeichnisauswahl **über** dem Dialog; Hape kann ein Verzeichnis suchen, anklicken oder eintippen, und der Dialog zeigt danach das gewählte Ziel. Dasselbe gilt für den Prompt-Editor (Ctrl+G), der aus demselben Dialog geöffnet wird und dasselbe Problem hat.

## Why

Hape dispatcht Agents aus DevOrbit heraus; ohne wählbares Verzeichnis landet jede neue Session im Standard-Ziel, der Dialog ist damit für andere Repos unbrauchbar. RC (root cause), am Code geprüft (`origin/main` c42050f): `TaskComposerModal` (`components/CommandPalette/TaskComposerModal.tsx:25`) liegt auf `z-[90]`, `DirectoryPicker` und `PromptEditor` in `components/AgentsView/AgentsView.tsx` (~Z. 1952 und ~2009) nur auf `z-50`. Beide werden als Geschwister nach dem Modal gerendert, verlieren aber den Stacking-Vergleich.

## Guardrails

- Kleinster Fix: z-index von `DirectoryPicker` und `PromptEditor` über das Composer-Modal heben (z.B. `z-[95]`), weil die Command-Palette mit `z-[100]` weiter oben bleiben soll. Kein Portal, kein Umbau der Modal-Struktur.
- Annahme: Die übrigen `z-50`-Dialoge (`ResumePicker`, `AgentSettingsPanel`, `ShortcutsHelp`) bleiben unverändert, weil sie nicht aus dem Composer heraus geöffnet werden. Wird beim Prüfen ein weiterer Dialog gefunden, der aus dem Composer öffnet, gleich mitziehen.
- Focus-Trap (`useDialogA11y`) nicht ändern: er lässt Fokus in fremden `[aria-modal="true"]`-Elementen zu, beide Dialoge tragen das Attribut.
- Escape/Klick auf den Picker-Hintergrund soll nur den Picker schließen, der Composer bleibt offen.
- Out of scope: Redesign des Pickers, gemeinsame z-index-Skala/Tokens.

## Done means

- Im Browser (`bun run dev`, `/agents`): „New task“ öffnen → Ordner-Button → Picker sichtbar oben, Auswahl per Klick und per Enter setzt `targetCwd`, Composer bleibt offen mit Fokus im Eingabefeld. Ctrl+G im Composer → Editor sichtbar oben. Nachweis per Screenshot (Playwright) im PR.
- `bun run build` und vorhandene Tests grün; Diff berührt nur die z-index-Klassen.
- Rückmeldung: PR-Link, ein Satz zu RC und Fix, Annahmen.

## First on approval

Worktree von `origin/main` anlegen und in `components/AgentsView/AgentsView.tsx` die Klasse `z-50` von `DirectoryPicker` und `PromptEditor` auf `z-[95]` setzen.
