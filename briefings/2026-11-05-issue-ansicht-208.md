# Briefing: Issue-Ansicht – Verknüpfungen oben, Kommentar-Reihenfolge wählbar (#208)

## The Job

Hape beim Öffnen eines Issues sofort zeigen, welche Agents daran arbeiten, welche PRs und Sub-Issues existieren, ohne an Beschreibung und Kommentaren vorbeizuscrollen; Beschreibung und Kommentare ans Ende stellen; die Kommentare wahlweise älteste oder neueste zuerst lesen lassen und diese Wahl merken. Betroffen sind Board-Seitenpanel und Issue-Modal (beide rendern `components/BoardView/BoardItemPanel.tsx`) sowie `components/BoardView/IssueComments.tsx`, das auch die Fallback-Ansicht in `IssueModal.tsx` (Issue nicht auf dem Board) nutzt.

## Why

Hape steuert seine Agents über das Board (mw board). Heute liegen „Agents an diesem Issue", „Pull Requests" und „Sub-Issues" unter Body und Kommentaren ganz unten (Screenshot im Issue). Bei langen mw-board-Strängen ist meist der neueste Kommentar relevant.

## Guardrails

- Abschnitte nur umsortieren, Inhalt und Verhalten der Abschnitte bleiben gleich, weil der Auftrag nur die Anordnung betrifft.
- Umschalter in `IssueComments`, damit Panel, Modal und Fallback-Ansicht ihn ohne Zusatzcode bekommen.
- Präferenz in `localStorage` mit try/catch (Muster `FOLD_KEY` in `BoardGrid.tsx`), weil reine Ansichtseinstellung; kein Server-Setting.
- Sortierung nach `createdAt` im Client; `fetchIssueComments` und Server bleiben unverändert.
- Stil: vorhandene Tailwind-Klassen und lucide-Icons, deutsche UI-Texte, Umschalter per Tastatur bedienbar mit zugänglichem Zustand (`aria-pressed` oder Label).
- Out of scope: Markdown-Rendering, Einklappen von Abschnitten, andere Views.

## Done means

| ID   | Bedingung                                                                                                                                                                                 | Nachweis                                                                                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Panel (`variant` Seitenpanel und `modal`) zeigt in dieser DOM-Reihenfolge: Titel → Metadaten (`<dl>`) → FlowControls/Go → Agents → Pull Requests → Sub-Issues → Beschreibung → Kommentare | vitest-Test in `test/`, rendert `BoardItemPanel` mit Agent-Link, PR, Sub-Issue, Body und Kommentaren und prüft die Reihenfolge per `compareDocumentPosition` |
| AC-2 | Umschalter „Älteste zuerst / Neueste zuerst" ordnet die Kommentare nach `createdAt` auf- bzw. absteigend, unabhängig von der API-Reihenfolge                                              | vitest-Test mit drei Kommentaren in gemischter Reihenfolge, Klick auf den Umschalter, Reihenfolge der Autoren in beiden Modi geprüft                         |
| AC-3 | Die Wahl überlebt Remount und Issue-Wechsel (global, nicht pro Issue); Default ohne gespeicherten Wert ist „Älteste zuerst"; kaputter oder blockierter `localStorage` bricht nichts       | vitest-Test: Wahl treffen, unmounten, mit anderer `issueId` neu mounten → Modus bleibt; `localStorage.getItem` wirft → Default, kein Fehler                  |
| AC-4 | Composer steht am neuesten Ende: bei „Neueste zuerst" über der Liste, bei „Älteste zuerst" darunter; Senden, Antworten, Zitieren funktionieren in beiden Modi                             | vitest-Test prüft Position der Textarea relativ zur Liste in beiden Modi und dass Antworten den Text in die Textarea einfügt                                 |
| AC-5 | Bestehendes bleibt grün: alle Tests, Typecheck                                                                                                                                            | `bunx vitest run` und `bunx tsc --noEmit` ohne Fehler, Ausgabe im PR                                                                                         |
| AC-6 | Endzustand sichtbar in der laufenden App                                                                                                                                                  | Screenshots im PR unter `## Screenshots`: Panel oben (Metadaten + Agents + PRs) und Kommentare in beiden Modi; GIF des Umschaltens                           |

## Ambition

- Altitude: keine; ein späterer Schritt wäre Einklappen langer Bodies/Kommentare, nicht Teil dieses Auftrags.
- Depth: echte Issue-Daten aus dem Board (z. B. ein mw-board-Issue mit vielen Kommentaren) für die Sichtprüfung; Ziel: Agents und PRs ohne Scrollen sichtbar bei 800 px Panelhöhe.
- Crew: tut, was eine A11y-Prüferin tut: Umschalter nur per Tastatur bedienen und Screenreader-Zustand prüfen.

## Prüfung

wegwerf · selbst · reine Anordnungs- und Ansichtsänderung ohne Vertrauensgrenze, Ausfall und Neubau kosten wenig.

## First on approval

Worktree vom aktuellen `origin/main` anlegen und die Abschnittsblöcke in `BoardItemPanel.tsx` umsortieren.

## Annahmen

- Default „Älteste zuerst" (wie GitHub), eine globale Einstellung für alle Issues. (vorgeschlagen)
- Composer wandert mit an das neueste Ende der Liste. (vorgeschlagen)
- FlowControls und Go-Button bleiben direkt bei den Metadaten, vor Agents/PRs, weil sie Teil der Steuerung sind. (vorgeschlagen)
- Reihenfolge der neuen oberen Abschnitte: Agents → Pull Requests → Sub-Issues, wie heute. (vorgeschlagen)
- `ui: on` für den Lauf, weil sichtbare UI sich ändert. (vorgeschlagen)
