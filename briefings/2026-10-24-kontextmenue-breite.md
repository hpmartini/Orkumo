# Briefing: Kontextmenü im linken Panel auf Inhaltsbreite

## The Job

Das Rechtsklick-/Tastatur-Kontextmenü der linken Agents-Leiste (`components/AgentsView/AgentList.tsx`, Block `role="menu"` am Ende der Komponente) ist so breit wie sein längstes Label, höchstens ca. 14rem. Lange Labels laufen nicht über, sondern werden gekürzt (`truncate`, voller Text im `title`). Ergebnis ist ein PR auf `macc/62`, der Issue #51 schließt (`Closes https://github.com/hpmartini/DevHub/issues/51`) und eine `## Review-Anleitung` enthält.

## Why

Hape baut DevOrbit als einheitliche Arbeitsumgebung für agentische Entwicklung (Epic #62 „Einheitliche Shell“, Leitbild `docs/VISION.md`). Das überbreite Menü verdeckt den Baum und wirkt unfertig. Wichtig zu wissen: PR #64 (Commit `bf8bbe5`, auf `main`) hat das Menü bereits von `min-w-[200px]` auf `w-max min-w-[10rem] max-w-[14rem]` umgestellt und `Closes #51` enthalten; das Issue blieb offen, weil der Merge nicht auf den Default-Branch ging. Hape hat es trotzdem erneut zum Bau freigegeben – entweder ist es real noch zu breit, oder es fehlt nur der Nachweis und das Schließen.

## Guardrails

- Nur das Menü in `AgentList.tsx` anfassen; Positions-Clamp (`window.innerWidth - 232`) muss zur Maximalbreite passen, weil das Menü sonst rechts aus dem Fenster ragt.
- Andere Menüs (`KebabMenu.tsx` in der App-Sidebar, `AgentSummaryBar`, `AgentTerminal`) bleiben unverändert – nicht Teil dieses Issues. Fällt dort dasselbe Problem auf, als Notiz im PR melden.
- Tastaturbedienung (ContextMenu/Shift+F10, Pfeiltasten, Escape) und `role="menu"`/`menuitem` bleiben erhalten.
- Annahme: „linkes Panel“ = Agents-Leiste im Agents View (`/agents`), weil #51 Sub-Issue von #45 „Agents-Leiste Runde 5“ ist.
- Annahme: Ist das Menü auf aktuellem `main` bereits ≤ 14rem und inhaltsbreit, reicht ein PR mit dem Nachweis (Screenshot/Messung) und ggf. einem kleinen Regressionstest; kein künstlicher Code-Umbau.

## Done means

- Im laufenden App (`bun run dev`, `/agents`) gemessen: Menü einer Session-Zeile und einer Gruppen-Zeile hat `getBoundingClientRect().width` ≤ 224px und ≈ Breite des längsten Labels plus Padding; ein künstlich langes Label wird mit Ellipse gekürzt, kein horizontaler Überlauf. Messwerte und Screenshot im PR.
- Menü nahe rechtem Fensterrand bleibt vollständig sichtbar.
- `bun run lint`, `npx tsc --noEmit`, Testsuite und `bun run build` grün.
- Rückmeldung: kurzer Bericht – Befund (war schon gefixt / RC (root cause) und Fix), Messwerte, PR-URL.

## First on approval

App auf `macc/62` starten, in `/agents` das Kontextmenü öffnen und seine tatsächliche Breite messen.
