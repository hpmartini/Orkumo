# Konzept: Threads- und Status-Ansichten

Stand 2026-11-26 · Branch `feat/threads-status-redesign` (Orkumo + agents-ui) · Status: **Entwurf zur Freigabe, kein Produktionscode**

Ziel: Hape steuert täglich 5–15 Agents und sieht ohne Nachfragen, wer arbeitet, wer auf ihn wartet, wer fertig ist, wer gescheitert ist – und in welchem Thread er antworten muss.

Prototyp: agents-ui `demo/prototype.tsx`, Start `npx vite demo --port 5611 --strictPort` im agents-ui-Worktree, dann `http://localhost:5611/?view=prototype` (Parameter unten).

## 1. Methode und Belege

- impeccable `context` → `critique` (zwei getrennte Assessments: Design-Review nach Rubrik, Detector + Browser) → `shape`. Ohne Rückfragekanal: Annahmen aus dem Briefing abgeleitet und unten markiert.
- Vorher-Screens stammen aus einer **isolierten Fixture-Instanz** (eigenes `DEVORBIT_DATA_PATH`, Fake-`HOME`, Stub-`claude`, 7 Agents in gemischten Zuständen). Sie sind Rekonstruktionen der echten Fälle, keine Mitschnitte der echten App:
  - `before-03` bildet den dokumentierten Fall „dauerbeschäftigt“ nach (Retro `~/MAGOS/system/runs/handoff/retro-dauerbeschaeftigt.md`, Fixture-Kombination `turn ended, own subagents still running` in `test/fixtures/workingStates.js`).
  - `before-04` rekonstruiert den Fehlrouting-Fall aus derselben Retro (Antwort im falschen Thread, unbeantwortete Nachfrage).
  - `before-05` (Frage nur im Antworttext, Status idle) entspricht der Kombination `goal active, no turn` → idle aus `workingStates.js`.
- Echtes Belegbild (Antwortkarte über volle Breite, ~2000 px, „3 steps“): liegt nur lokal in den App-Daten von Hape, wird hier bewusst **nicht** ins öffentliche Repo kopiert.
- Orkumo hat **kein helles Theme** (rekursiv geprüft: keine `prefers-color-scheme`/Theme-Umschaltung in `components/ hooks/ utils/`). Vorher-Screens gibt es deshalb nur dunkel. Helle Variablen existieren nur in der agents-ui-Demo (`?theme=light`); der Prototyp nutzt sie.

## 2. Critique (Ist-Zustand)

**Nielsen-Score 19/40 – Poor (12–19).** Die Kernaufgabe „wer braucht mich“ ist unzuverlässig.

| Heuristik                     | Score | Kernbefund                                                                                                                           |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Sichtbarkeit des Systemstatus | 1     | 2 von 7 Agents zeigen falschen Status; Kopf „working…“, Fußzeile „Done · 48 s“ und Spinner „2 steps“ gleichzeitig (`before-03`)      |
| Sprache der Nutzer            | 2     | „Keys: agent list / F6“, „0 cache expiring“, rohe cwd-Pfade und Modell-ID im Pane-Kopf                                               |
| Kontrolle und Freiheit        | 3     | Threads schließbar, Frage-Karte hat „Other answer“; kein Rückgängig für falsch geroutete Antwort                                     |
| Konsistenz                    | 2     | Ein Zustand, drei Namen: „awaiting input“ / „needs input“ / „The agent is asking“; idle heißt auch „ready“; ✻ für fast alle Zustände |
| Fehlervermeidung              | 1     | Zwei aktive Composer mit gleichem Hinweis; Thread-Composer nennt sein Ziel nicht (`before-04`)                                       |
| Wiedererkennen statt Erinnern | 2     | Rail-Zeilen von needs-input und failed zeigen weder Frage noch Grund (`before-01`)                                                   |
| Effizienz                     | 3     | Tastatur vorhanden; kein „nächster, der mich braucht“                                                                                |
| Ästhetik, Minimalismus        | 2     | Null-Zähler in der Leiste, ~40 px Leerraum pro Rail-Karte, Cloud-Block dauerhaft sichtbar                                            |
| Fehler erkennen und beheben   | 1     | Failed = rotes ✻ + „46s“ in der Rail, im Pane Kopf „ready“, kein Grund, keine Aktion (`before-10`)                                   |
| Hilfe                         | 2     | Leerzustände helfen, Zustände/Glyphen sind nirgends erklärt                                                                          |

Detector (`impeccable detect`): Quellcode Chat + AgentList 1 Fund (`gray-on-color`, `ChatThreads.tsx:528`, Fehlalarm: graue Schrift nur im disabled-Zustand auf grauem Grund). URL-Scan der Instanz scheiterte (Navigation-Timeout 30 s, vermutlich offene SSE/PTY-Verbindungen) – kein sauberes Ergebnis, nur Fehler. Konsole: nur der erwartete `502 /api/board/items` (kein GitHub in der Fixture).

Stärken, die bleiben: die Frage-Karte (Frage als Überschrift, Optionen mit Folgen-Hinweis, Tastatur), die Thread-Marker „N replies in thread …“ im Hauptchat, Activity-Chips mit echten Namen der Hintergrundarbeit.

### Hauptprobleme

1. **P0 – Status lügt: „working“, obwohl nur Hintergrund-Tasks laufen.** Orchestrator mit beendetem Turn und 3 Tasks zeigt „working…“, Spinner mit fremdem Schritt „Read notes.md“ und „2 steps“; die Leiste zählt ihn als „2 working“. Hape wartet oder drängelt. → `before-03-false-working.png`
2. **P0 – Antwort landet im falschen Thread, Nachfrage bleibt unbeantwortet und unsichtbar.** „hello?? can we raise the workers?“ im Thread WebKit suite, darunter eine fremde Antwort „Noted the docs freeze for Friday.“ und „Working…“. „new“-Badges unterscheiden nicht „neue Antwort“ von „wartet auf Antwort“. → `before-04-thread-misroute.png`, `before-09-max-threads.png`
3. **P1 – „Braucht dich“ ist nicht auffindbar.** Zustand nur per Farbe eines ✻ (gelb vs. orange kaum unterscheidbar), Rail-Zeile zeigt die Frage nicht, Gruppierung nach Projekt verstreut die wartenden Agents (needs-input steht in Gruppe 4 von 6). Eine Frage im Antworttext zählt als idle/„ready“. → `before-01-rail.png`, `before-02-question-card.png`, `before-05-prose-question-idle.png`
4. **P1 – Antwortkarten über volle Breite.** 1600 px: ~1060 px Zeilen, 1920 px: ~230 Zeichen pro Zeile; die eigentliche Frage steht fett am Ende. → `before-06-max-reading-width.png`, `before-07-narrow-reading.png`
5. **P2 – Pills ohne Art und Status.** Chips zeigen nur Beschreibung/Befehl; nur der Subagent hat einen Spinner; „general-purpose · Draft changelog from …“ schneidet genau den unterscheidenden Teil ab. Bei 1100 px bricht die Kopfleiste zweizeilig um. → `before-03`, `before-08-narrow-threads.png`

## 3. Zielbild

### 3.1 Informationshierarchie

1. **Rail = Eingangskorb, nicht Projektbaum.** Drei feste Gruppen oben nach Dringlichkeit: **Needs you** (Waiting for you, Failed) → **Running** (Working, Waiting on tasks) → **Finished** (Done, Idle). Projekt wird Tag in der Zeile (Filter bleibt). Orchestratoren bleiben normale Zeilen mit Tag.
2. **Jede Zeile beantwortet „was jetzt“**: Name · Alter; Zustand als **Wort + eigene Icon-Form** (nicht nur Farbe); zweite Zeile = Frage (needs you, voll umbrochen), Fehlergrund (failed), aktueller Schritt (working), „3 tasks · 1 thread without answer“ (waiting on tasks), Ergebnis (done).
3. **≤ 1 Klick zur Frage**: Klick auf eine Needs-you-Zeile öffnet den Agent mit der Frage über dem Composer. Taste `N` springt zum nächsten Agent, der dich braucht. Im Prototyp gemessen: aus einem fremden Split-Pane bei 1100 und 1600 px → 1 Klick, Frage sichtbar.
4. **Pane-Kopf**: Name, Zustand als Wort, Projekt. Pfad/Modell wandern in ein Detail-Menü.
5. **Ein Vokabular überall** (Leiste, Rail, Pane, Tab-Titel): Working · Waiting for you · Waiting on tasks · Done · Failed · Idle. Nullzähler in der Leiste entfallen.

### 3.2 Zustände und Herleitung

| Ziel-Zustand         | Rail-Gruppe | heutige `displayState` | Herleitung (Quelle)                                                                                                 |
| -------------------- | ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Waiting for you**  | Needs you   | `needs-input`          | Job `blocked` oder Dialog auf dem Pane-Screen (`agentDialog.ts`); offen: Frage im Antworttext, siehe Entscheidung 3 |
| **Failed**           | Needs you   | `failed`               | Job `failed` / Fehler-Toolresult; Grund = letzte Fehlermeldung                                                      |
| **Working**          | Running     | `working`              | **ein Turn läuft** – Turn-Ende aus dem Transkript, nicht aus `tempo`                                                |
| **Waiting on tasks** | Running     | `waiting`              | Turn beendet, `inFlight.tasks > 0`; Text nennt Anzahl und Art                                                       |
| **Done**             | Finished    | `completed`            | Job `done`                                                                                                          |
| **Idle**             | Finished    | `idle`, `stopped`      | kein Turn, keine Tasks, keine Frage                                                                                 |
| Looping              | Running     | `loop`                 | `/loop` aktiv; Zeile nennt Intervall und nächsten Lauf                                                              |
| Interactive          | Finished    | `interactive`          | Sitzung außerhalb Orkumo, Aktivität unbekannt; graue Zeile „Interactive · activity unknown“                         |

Die Korrektur der Statuslogik („working“ aus dem Turn-Ende statt aus dem Tempo, Schrittzähler wird bei jedem Turn-Start zurückgesetzt) liefert **ein anderer Agent** (Retro `retro-dauerbeschaeftigt.md`, Vorschläge 1 und 2; Fixture-Fälle in `test/fixtures/workingStates.js`). Dieses Konzept setzt sie voraus und baut nur die Darstellung darauf. Hinweis: dieser Agent hat seine Commits auf denselben Branch gelegt – Orkumo `7ef9a9f` (fix(agents): working only while a turn runs…), agents-ui `483fa69` (fix(chat): steps restart at every turn start…); nicht Teil dieses Konzepts, von mir nicht geprüft. Was darüber hinausgeht (Frage im Prosatext, unbeantwortete Thread-Nachricht als eigener Zustand), ist **nicht beschlossen** und steht als Entscheidung im Handoff.

### 3.3 Threads und Pills

**Threads** werden Tabs unter dem Pane-Kopf: `Main` + je Thread ein Tab mit Zustand. Ein Thread mit eigener Nachricht ohne Agent-Antwort trägt **„No answer · 12m“** (amber), die Nachricht selbst „No answer yet · sent 12m ago“. Der Composer nennt immer sein Ziel („To: WebKit suite“, Platzhalter „Reply in thread “WebKit suite”“); es gibt pro Pane genau einen Composer, der Tab bestimmt das Ziel. Damit fällt die heutige Zweiteilung Hauptchat/Thread-Panel (zwei aktive Eingabefelder) weg.

**Pills über dem Composer** zeigen `Art · Name · Status`: „Shell · Preview server · running 14m“, „Subagent · Draft changelog · working · step 4“. Klick öffnet darüber eine Detailkarte (Befehl, letzte Ausgabezeilen, Start); erneuter Klick oder × schließt. Fertige Pills zeigen „done“/„failed“ und verschwinden nach dem nächsten Turn.

**Empfehlung: Subagents sind Threads (ein Modell für beides).** Jeder Subagent bekommt einen Thread-Tab mit Bot-Icon, Zustand und eigenem Verlauf; seine Pill verlinkt dorthin.

- Für: ein Ort für „was läuft da und was sagt es“, gleiche Status-Logik, Antworten an einen Subagent sind eindeutig geroutet; die Orchestrator-Threads werden der Normalfall statt Sonderfall.
- Gegen: mehr Tabs bei agentlastigen Läufen (10+ Subagents) → Tabs brechen um; Gegenmittel: fertige Subagent-Threads klappen in „N finished“ zusammen. Subagents liefern heute nur Start/Ende im Transkript, kein Zwischenstand → Thread zeigt anfangs wenig.
- Alternative: Subagents nur als Pills mit Detailkarte (weniger Fläche, aber zwei Modelle).

### 3.4 Lesebreite der Antwortkarten

- Fließtext der Antwort max. **60ch im CSS ≈ 74 Zeichen pro Zeile** (Inter), linksbündig; Karte ohne Rahmen, Kopfzeile klein. Eigene Nachrichten rechts, max. 60ch.
- Warum 60ch: `ch` ist die Breite der Ziffer 0; Inter-Fließtext ist schmaler, 72ch ergaben real ~91–95 Zeichen. Gemessen wird die echte Zeichenzahl pro gerenderter Zeile.
- Tabellen, Code, Diffs dürfen bis **110ch** wachsen; breiter → horizontales Scrollen **im Block**, nie die Seite (gemessen: `scrollWidth === clientWidth` am Dokument in allen 22 Prototyp-Screens).
- Gemessen im Prototyp (lange Docs-Antwort, Zeichen ÷ Zeilen): ~74 Zeichen bei 1100 px, 1920 px maximiert und im Split-Pane (1600 px, zwei Panes); Ziel 70–80 eingehalten.
- Frage-Karte, Fehlerkarte und Pill-Details folgen derselben Kante.

### 3.5 Issue-Ansicht: Repo-Köpfe (#327)

Problem (Issue-Bild in Orkumo#327): Repo-Name klein und grau vor `#nummer`, keine Trennung zwischen Repos. Ziel:

- Bei „alle Repos“ gruppiert die Liste nach Repo: Kopfzeile mit Repo-Name (14 px, semibold, Primärtext), Anzahl, darunter Trennlinie; der Repo-Präfix in der Zeile entfällt.
- Bei genau einem Repo keine Kopfzeile.
- Gleiche Gruppenkopf-Komponente wie die Rail-Gruppen (eine Quelle).
  Kein Vorher-Screen aus der Fixture (ohne GitHub keine Issues); Beleg ist das Issue-Bild.

### 3.6 Design-System-Lücken (claude-config#6) gegen Choice (agents-ui#20, Orkumo#358)

Geprüft an `src/components/Choice.tsx`, nicht am PR-Text:

| Forderung #6                  | Ist                                                                                                                              | Lücke                      | Plan                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 2–3 Optionen als Pills        | `CHOICE_PILL_MAX = 3`                                                                                                            | keine                      | –                                                                                                                       |
| Sofort-Filter ab >5 Einträgen | `CHOICE_SEARCH_THRESHOLD = 7`                                                                                                    | 6–7 Einträge ohne Filter   | Schwelle auf 5 (Entscheidung 4)                                                                                         |
| Filter tippt sofort           | Suchfeld bekommt beim Öffnen den Fokus                                                                                           | keine                      | –                                                                                                                       |
| Einheitlich überall           | Einzelwert-Auswahl ja; Mehrfachauswahl, Aktionsmenüs, Paletten, FolderPicker sind #358-Ausnahmen                                 | kein Mehrfach-Choice       | eigene Variante `multiple` erst bei zweitem Bedarf                                                                      |
| Ein System                    | kein App-`DESIGN.md` (das vorhandene gilt nur der Landingpage); kein helles Theme in Orkumo; Zustandsfarben/-namen nicht zentral | Tokens für Zustände fehlen | `DESIGN.md` für die App (Tokens, Zustandsvokabular, Lesebreite, Choice-Regeln) per `impeccable document` nach Umsetzung |

## 4. Vorher / Nachher

| Thema                   | Vorher                                                               | Nachher (Prototyp)                                                    |
| ----------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Rail                    | `before-01-rail.png`                                                 | `after/01-needs-you-{dark,light}.png`                                 |
| Frage auffinden         | `before-02-question-card.png`                                        | `after/01-needs-you-*` (Frage in Zeile + über Composer, Choice-Pills) |
| Frage nur im Text       | `before-05-prose-question-idle.png`                                  | `after/02-prose-question-*` („from the answer text“)                  |
| Failed                  | `before-10-failed.png` (Pane-Kopf „ready“, kein Grund, keine Aktion) | `after/03-failed-*` (Grund, Show log, Retry)                          |
| Falsches working        | `before-03-false-working.png`                                        | `after/04-waiting-on-tasks-*`                                         |
| Thread-Fehlrouting      | `before-04-thread-misroute.png`, `before-09-max-threads.png`         | `after/05-unanswered-thread-*`                                        |
| Subagent als Thread     | –                                                                    | `after/06-subagent-thread-*`                                          |
| Pills                   | `before-03` (Chips)                                                  | `after/07-pill-open-*`                                                |
| Lesebreite maximiert    | `before-06-max-reading-width.png`                                    | `after/08-reading-max-*`                                              |
| Lesebreite schmal/Split | `before-07-narrow-reading.png`, `before-08-narrow-threads.png`       | `after/09-reading-split-*`, `after/10-narrow-*`                       |
| Working                 | –                                                                    | `after/11-working-*`                                                  |

Alle Bilder unter `briefings/assets/threads-status/`.

## 5. Shape-Brief (für die Umsetzung)

- **Mode:** Operate. Klarheit vor Ausdruck; Marke steckt in Präzision (Vokabular, Kanten, Zustände).
- **Umfang erste Stufe:** Rail-Gruppen + Zeilentext, Zustandsvokabular, Pane-Kopf, Lesebreite, Composer-Ziel, Pills mit Art/Status. Zweite Stufe: Thread-Tabs statt Thread-Panel, Subagent-Threads, „No answer“-Erkennung. Dritte: #327, Choice-Schwelle, App-`DESIGN.md`, helles Theme.
- **Annahmen (aus dem Briefing abgeleitet, nicht bestätigt):** A1 Hape arbeitet überwiegend dunkel, helles Theme ist Wunsch, kein Muss. A2 Projekt-Gruppierung ist verzichtbar, wenn Projekt-Tag + Filter bleiben. A3 „No answer“ ab sofort nach dem Senden, Hervorhebung ab 5 min. A4 ~74 Zeichen pro Zeile passen auch für Deutsch.
- **Nicht im Umfang:** Statuslogik selbst (anderer Agent), Terminal-Ansicht, Board.
