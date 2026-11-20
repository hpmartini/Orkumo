# Ziel-Vertrag: Lage-Ansicht – Orchestratoren melden ihren Stand an Orkumo Pro

Quelle: Briefing vom 2026-11-19 (Orchestrator-Workspace), hier als Ziel-Vertrag nach `mw:goal-contract`.

## The Job
Hape **sieht** an einer Stelle, was alle Orchestratoren und das MACC-Board gerade bewegen, **erkennt** sofort, was ihn braucht, und **handelt** dort: Option wählen, To-do abhaken, Freigabe bestätigen. Orchestratoren **melden** ihren Stand strukturiert per `orkumo report - < stand.json`; der Server **prüft** jede Meldung gegen ein versioniertes Schema, **speichert** den letzten Stand je Orchestrator, **protokolliert** Änderungen und **leitet** Hapes Antworten über den Pfad von `orkumo send` an den zuständigen Orchestrator zurück. Die Ansicht „Lage“ (Pro-Modul in DevHub-pro) **liest** diese Stände und das MACC-Board (über das Workflow-Plugin) und **führt** doppelte Einträge über die Issue-URL **zusammen**.

Problem: Hape verliert bei mehreren Orchestratoren und vielen Projekten den Überblick und muss nachfragen. Vermutete Lösung: Meldepflicht + strukturierte Gesamtansicht mit Rückkanal.

Datenmodell (fachlich, Feldnamen legt das Schema fest):
- Projekt → Aufgabe; Aufgabenzustand ∈ {geplant, läuft, wartet auf Hape, fertig, abgebrochen}; Verweise auf PR-, Issue- und Agent-IDs.
- Einträge „Für Hape“: Entscheidung (Optionen + Empfehlung), To-do (Hapes Handgriff), Freigabe (PR zum Mergen).
- Eintrag beantwortet → zeigt „beantwortet“, bis der Orchestrator ihn in der nächsten Meldung schließt.

Darstellung: Eintrag „Lage“ in der Aktivitätsleiste; oben Eingang „Für dich“ nach Dringlichkeit; darunter Projekte als aufklappbare Liste mit Aufgaben (kein Kanban); in jedem Orchestrator-Tab und jeder Split-Ansicht ein Knopf, der „Lage“ auf diesen Orchestrator filtert.

Rollenvorgaben: `server/orchestrator/agents.md`, `skill.md` und Rollen in `roles/` machen das Melden zur Pflicht; die bestehenden Orchestratoren werden umgestellt.

Zweite Ausbaustufe: Orchestratoren anderer Macs über Cluster/Mesh in derselben Ansicht (siehe Annahmen).

## Why
Hape koordiniert mit wenigen Orchestrator-Agents viele Projekte parallel. Heute fragt er nach dem Stand oder liest uneinheitliche HTML-Übersichten. Danach muss er nie mehr nach dem Stand fragen: Eine Ansicht zeigt, was ihn braucht, und er handelt direkt dort.

## Guardrails
- **Ort:** Schema, `orkumo report`, Speicherung, Änderungsprotokoll und Rückkanal im freien Orkumo (neben `server/services/orchestratorService.js`, `server/orchestrator/`). Ansicht „Lage“ als Pro-Modul in DevHub-pro nach dem Muster `cluster`/`workflows`, Modulvertrag `docs/MODULES.md`.
- **ADR-001:** MACC nur lesend und nur über das Workflow-Plugin, nie über mw-Labels im Core. Board-Issues schreibt nur der Board-Orchestrator.
- **Öffentliches Repo:** keine echten Projekt-, Kunden- oder Gerätenamen in Code, Tests, Fixtures, Screenshots; nur neutrale Beispieldaten.
- **Zuständigkeit:** Jede Meldung trägt die Orchestrator-ID; ein Orchestrator schreibt nur seinen eigenen Stand, nie den eines anderen.
- **„Veraltet“:** keine feste Frist (Nachtruhe normal). Veraltet = nach der letzten Meldung ist in seinem Bereich ein Ereignis passiert (Worker beendet, PR gemergt oder grün, eigener Turn beendet) und er hat binnen **30 Minuten** nicht neu gemeldet.
- **macOS-Mitteilung** nur bei einer **neuen Entscheidung** „Für dich“, sonst nie.
- **Weitere Leser:** nicht in dieser Fassung; das Schema bleibt offen (versioniert, unbekannte Zusatzfelder in einem Erweiterungsbereich erlaubt), damit später andere Systeme es lesen können.
- **Vorgehen:** erst klickbarer Wegwerf-Prototyp mit neutralen Daten, Hape gibt frei; höchstens **4** parallele Subagents.
- **UI:** alle Oberflächen (Prototyp, Ansicht, Eingang, Projektliste, Filter-Knopf, Zustände) mit `/impeccable`.
- **Unverändert:** bestehendes Board, Workflows, Cluster, `orkumo send`.
- **Lieferung:** PRs in Orkumo und DevHub-pro, nicht mergen. Stopp nur bei Unklarheit im Schema-Vertrag oder Konflikt mit ADR-001.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Ein versioniertes JSON Schema (Feld `schemaVersion`) beschreibt Meldung, Projekt, Aufgabe (5 Zustände), PR-/Issue-/Agent-Verweise und die drei Eintragsarten „Für Hape“; die Beispielmeldung ist gültig, kaputte Meldungen (fehlende Orchestrator-ID, unbekannter Zustand, falsche Version) werden abgelehnt. | Schema-Tests (vitest) gegen Beispiel und Negativfälle |
| AC-2 | `orkumo report - < stand.json` schickt die Meldung an den laufenden Server; gültig → gespeichert (überlebt Server-Neustart) und Änderungsprotokoll-Eintrag; ungültig → Exit ≠ 0 mit verständlicher Fehlermeldung, nichts gespeichert. | CLI-Test über den echten Einstiegspunkt gegen einen gestarteten Server mit echtem Datenverzeichnis, zwei Serverstarts nacheinander |
| AC-3 | Ein Orchestrator kann nur seinen eigenen Stand schreiben: Meldung mit fremder Orchestrator-ID bzw. von einer Sitzung, die nicht als Orchestrator markiert ist, wird abgelehnt (4xx), der fremde Stand bleibt unverändert. | Route-Test |
| AC-4 | Antwort in der Ansicht (Option gewählt / To-do abgehakt / Freigabe bestätigt) erzeugt eine Nachricht an den zuständigen Orchestrator über denselben Pfad wie `orkumo send`; der Eintrag steht danach auf „beantwortet“, bis die nächste Meldung des Orchestrators ihn schließt. | Route-Test + echter Durchlauf mit einem Orchestrator (Transkript zeigt die Nachricht, Folge-Meldung schließt den Eintrag), Screenshot vorher/nachher |
| AC-5 | Regel „veraltet“: veraltet genau dann, wenn nach der letzten Meldung ein Ereignis (Worker beendet, PR gemergt oder grün, eigener Turn beendet) in seinem Bereich passiert ist und 30 Minuten ohne neue Meldung vergangen sind; ohne Ereignis nie veraltet, egal wie lange; bei 29:59 nicht, bei 30:00 veraltet. | Unit-Tests mit Grenzfällen (kein Ereignis + 12 h, Ereignis + 29:59, Ereignis + 30:00, Ereignis vor der Meldung) |
| AC-6 | macOS-Mitteilung nur bei einer neu hinzugekommenen Entscheidung „Für dich“; keine bei To-do, Freigabe, wiederholter Meldung derselben Entscheidung oder Aufgabenänderung. | Unit-Test des Auslösers |
| AC-7 | Die Ansicht „Status“ (Pro-Modul, UI englisch) erscheint als Eintrag in der Aktivitätsleiste; ohne Modul ändert sich in Orkumo nichts. Oben „For you“ nach Dringlichkeit mit dem Projekt als eigener Spalte je Eintrag, darunter aufklappbare Projektliste („Projects“) mit Aufgaben, kein Kanban. | Browser-Screenshots Eingang + Projektliste im PR (`## Screenshots`), Konsole ohne Fehler |
| AC-8 | MACC-Items erscheinen im selben Modell, gelesen nur über das Workflow-Plugin (kein mw-Label-Code im Core); ein Issue, das ein Orchestrator meldet und das auf MACC liegt, erscheint genau einmal (Zusammenführung über Issue-URL). | Test der Zusammenführung + `git grep` im Orkumo-Diff ohne mw-Labels + Screenshot |
| AC-9 | Jeder Orchestrator-Tab und jede Split-Ansicht hat einen Knopf („Show in Status“), der „Status“ auf diesen Orchestrator filtert. | Browser-Screenshot gefilterte Ansicht + GIF des Ablaufs Tab → Knopf → gefilterte Ansicht |
| AC-10 | Lade- und Fehlerzustand der Ansicht sind gestaltet (nicht leer, nicht abgeschnitten). | Browser-Screenshots beider Zustände |
| AC-11 | `agents.md`, `skill.md` und Rollen in `roles/` verlangen die Meldung (wann, wie, Beispiel); die drei bestehenden Orchestratoren sind umgestellt und haben je mindestens einmal über `orkumo report` gemeldet. | Diff der Vorlagen + Änderungsprotokoll auf Hapes Rechner mit drei verschiedenen Orchestrator-IDs |
| AC-12 | Bestehendes Board, Workflows, Cluster und `orkumo send` verhalten sich unverändert. | bestehende Tests grün, keine Änderung an deren Verhalten im Diff |
| AC-13 | Keine echten Projekt-, Kunden- oder Gerätenamen im Orkumo-Diff (Code, Tests, Fixtures, Screenshots). | Durchsicht des Diffs + Screenshots nur mit neutralen Daten |
| AC-15 | Höchstens 4 Subagents laufen gleichzeitig. | Sitzungsprotokoll / Bericht nennt die Zahl |
| AC-14 | PRs in Orkumo und DevHub-pro offen, Woodpecker grün in beiden, nicht gemergt; deutscher Kurzbericht (Getan, Annahmen, PR-Links) an den auftraggebenden Orchestrator. | PR-Links + Woodpecker-Status |

## Ambition
- Altitude: Statt Meldepflicht könnte Orkumo den Stand selbst aus Transkripten und PRs ableiten; nur Vorschlag, nicht Scope (Ableiten ist ungenau bei Entscheidungen, die nur der Orchestrator kennt).
- Depth: echtes JSON Schema (Draft 2020-12) mit Validator, den das Repo schon hat oder der klein ist; Meldungen als Dateien je Orchestrator + JSONL-Änderungsprotokoll im Datenverzeichnis; Ziel: Meldung → sichtbar in der Ansicht < 2 s.
- Crew: tut, was ein Sicherheitsprüfer tut: Report-Route nur lokal bzw. mit Token, Orchestrator-ID gegen markierte Orchestratoren prüfen, Größenlimit für Meldungen, Freitext nie als HTML rendern. Tut, was ein Interaction Designer tut: Eingang nach Dringlichkeit testweise mit 0, 1 und 20 Einträgen ansehen.

## Prüfung
langlebig · unabhängig · neue Vertrauensgrenze (Eingaben von Agents ins Server-Datenmodell, Rückkanal in fremde Sitzungen) und Code, den andere Orchestratoren täglich nutzen.

## First on approval
Schema-Entwurf (JSON Schema mit Beispiel-Meldung) und klickbarer Wegwerf-Prototyp der Ansicht „Lage“ mit neutralen Daten (mit `/impeccable`), Hape zur Freigabe vorlegen; danach Stopp bis zur Freigabe.

## Annahmen
Hape hat am 2026-11-20 über playmaker den Prototyp freigegeben (Name der Ansicht „Status“, UI englisch, Projekt als Spalte in „For you“) und die Annahmen übernommen.

- Orchestrator-ID ist stabil: die Rollen-ID (`roles/<id>.md`), ohne Rolle die Agent-ID; Session-IDs wechseln beim Fortsetzen eines Panes und würden Stand und offene Einträge verwaisen lassen. `orkumo report` trägt die aktuelle Sitzung als `agentId` ein (aus `ORKUMO_AGENT_ID`/Session-Umgebung wie beim Absender von `orkumo send`), Antworten gehen dorthin. (übernommen)
- Durchsetzbar ist: die Absender-Sitzung ist in `agentView.orchestrators` markiert und ihre Rolle bzw. ID passt zur gemeldeten Orchestrator-ID. Nicht durchsetzbar: ein lokaler Prozess, der eine fremde Session-ID in die Umgebung schreibt (alle teilen das lokale Token); AC-3 belegt die Prüfung, nicht Fälschungssicherheit. (übernommen)
- Zweite Ausbaustufe (Cluster/Mesh, andere Macs) ist nicht Teil dieser Lieferung; das Schema trägt sie, weil die Orchestrator-ID je Rechner eindeutig ist und der Server die Herkunft ergänzen kann. (übernommen)
- Dringlichkeit im Eingang: erst optionale Priorität im Eintrag, dann Art (Entscheidung vor Freigabe vor To-do), dann Alter (älteste zuerst); beantwortete Einträge bleiben an ihrem Platz. (übernommen, Prototyp-Freigabe)
- „Ein Orchestrator meldet seinen Stand“ heißt: jede Meldung ist der vollständige aktuelle Stand (Snapshot), kein Delta; das Änderungsprotokoll entsteht serverseitig aus dem Vergleich. (übernommen)
- Ereignisse für „veraltet“ kommen aus Daten, die Orkumo schon hat (Agent-Zustände, Turn-Ende, PR-Status der verknüpften PRs). (übernommen)
- AC-11 (drei echte Orchestratoren) braucht ein installiertes Build der Branch auf Hapes Rechner; Installation/Neustart der App erst nach Hapes Ja. (übernommen)
- `ui: on` für die Lieferung (Screenshots + GIF Pflicht). (übernommen)
