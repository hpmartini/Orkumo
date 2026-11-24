# Briefing: Antworten-Knopf und Threads für Orchestrator-Chats (agents-ui, Orkumo)

## The Job
In der UI-Ansicht von Orkumo-Agents gibt es zwei Dinge:

**1. Antworten-Knopf an jeder Modell-Antwort** (alle Agents, erscheint beim Überfahren):
- Ein Klick setzt einen Zitat-Chip ins Eingabefeld, mit Uhrzeit und den ersten Zeilen der Antwort. Ist ein Textteil markiert, wird nur dieser zitiert.
- Gesendet wird an dieselbe Session, im Format: „Zu deiner Antwort von 14:32: »…«“, danach Hapes Text.

**2. Threads für Orchestrator-Sessions:**
- **Was ein Thread ist:** ein Ausschnitt derselben Orchestrator-Session, keine eigene Session.
- **Starten:**
  - über „Thread öffnen“ an jeder Antwort,
  - über „Instruct“ auf einer Status-Karte,
  - über „Neuer Thread“ im Panel, mit Auswahl von Projekt bzw. Aufgabe aus `orkumo report`.
- **Kennung:** Nachrichten aus dem Thread tragen eine Kennung, z. B. „[Thread: Orkumo · Status-Ansicht]“.
- **Zuordnung:**
  - Die Antwort des Orchestrators auf eine Thread-Nachricht gehört in den Thread. Der Orchestrator beginnt sie mit derselben Kennung, das steht in seiner Anleitung.
  - Meldungen von Workern, die mit dem Thread verknüpft sind (Agent-IDs bzw. Repo aus der Status-Aufgabe), wandern ebenfalls hinein.
- **Im Haupt-Chat** steht wie bei Slack nur „3 Antworten im Thread Orkumo · Status-Ansicht“, ein Klick öffnet den Thread.
- **Panel rechts im Tab bzw. in der Split-Ansicht:**
  - Oben die Liste der aktiven Threads mit Kurzname (Projekt · Aufgabe, Repo bzw. Unterordner im Monorepo), erster Nachricht, Zusammenfassung, Zahl ungelesener Nachrichten und Zeit.
  - Darunter der geöffnete Thread mit eigenem Eingabefeld, inklusive Bildern und Dateien wie im Haupt-Chat.
  - Threads lassen sich schließen. Der Zustand bleibt nach einem Neustart erhalten.

## Why
Hape lässt in jedem Orchestrator mehrere Projekte und Aufgaben gleichzeitig laufen. Heute ist alles ein langer Chat. Wer auf eine Antwort reagiert, muss Kontext selbst herauskopieren, und Antworten zu verschiedenen Aufgaben vermischen sich. Danach soll Hape gezielt auf einzelne Antworten und Aufgaben reagieren und jede Aufgabe als eigenen Gesprächsfaden verfolgen. Der Orchestrator behält dabei den Gesamtüberblick.

## Guardrails
- **Wo gebaut wird:**
  - Oberfläche in agents-ui (`~/REPOS/apps/agents-ui`, neuer Tag), damit Orkumo und MAGOS es bekommen.
  - Thread-Metadaten (Thread-ID, Bindung an Status-Projekt bzw. -Aufgabe, zugeordnete Nachrichten, gelesen-Stand) speichert der Orkumo-Server (`~/REPOS/apps/DevOrbitDashboard`), neben den Status-Meldungen aus #329/#335.
  - MAGOS zieht später nach, nicht in dieser Lieferung.
- **Zusammenfassung und Name:** Sie kommen aus der verbundenen Status-Aufgabe (`orkumo report`: title, note, description, refs), ohne zusätzlichen Modellaufruf. Ohne Bindung gilt die erste Nachricht.
- **Anleitung der Orchestratoren:** Die Regel „Antwort auf Thread-Nachricht beginnt mit derselben Kennung“ kommt in die Orchestrator-Vorlagen (`server/orchestrator/agents.md`, `skill.md`, `/status-report`). Senden geht über den vorhandenen Weg von Reply bzw. Instruct.
- **Unklare Zuordnung:** Eine Antwort ohne Kennung bleibt im Haupt-Chat. Sie wird nicht geraten.
- **Gilt für:** Claude- und omp-Transkripte.
- **Öffentliches Repo:** Orkumo und agents-ui sind öffentlich, also keine echten Namen in Code, Tests oder Screenshots.
- **Oberfläche:** mit `/impeccable`, englisch wie die übrige Orkumo-UI. Zuerst ein klickbarer Prototyp zur Freigabe durch Hape über playmaker.
- **Arbeitsweise:** eigene Worktrees, höchstens 3 Subagents.

## Done means
- **Browser, isolierte Orkumo-Instanz mit Wegwerf-Orchestrator:**
  - Auf eine bestimmte Antwort antworten: Das Zitat kommt im Transkript an.
  - Zwei Threads öffnen, einer an eine Status-Aufgabe gebunden. In jedem schreiben: Die Antworten landen im richtigen Thread, der Haupt-Chat zeigt die Zähler.
  - Die Worker-Meldung eines verknüpften Agents landet im Thread.
  - Liste mit Kurzname, Zusammenfassung und Ungelesen-Zahl. Zustand übersteht das Neuladen. Bild-Anhang im Thread.
  - Lade-, Leer- und Fehlerzustand, Konsole 0 Fehler.
  - Belege: Screenshots plus kurzes GIF.
- **Tests:** für die Zuordnungslogik (Kennung, Worker-Verknüpfung, „unklar bleibt im Haupt-Chat“). Woodpecker grün in Orkumo, agents-ui-Tests grün.
- **Lieferung:**
  - PRs in agents-ui (Tag) und Orkumo (Pin, Server, Vorlagen).
  - Nach Freigabe des Prototyps bis zum Merge-fähigen Stand. Gemergt wird über playmaker nach Hapes Freigabe.
- **Bericht** an playmaker, deutsch, knapp: getan, Annahmen, Links.

## First on approval
Klickbarer Prototyp mit `/impeccable`: Antworten-Knopf mit Zitat-Chip, Thread-Panel mit Liste und offenem Thread, Haupt-Chat mit Thread-Zählern. Neutrale Beispieldaten, Screenshots an playmaker zur Freigabe durch Hape.

## Ziel-Vertrag

### Ergebnis als Verben
Hape reagiert in der UI-Ansicht gezielt auf eine einzelne Modell-Antwort, ohne Kontext zu kopieren, und verfolgt in einer Orchestrator-Session jede Aufgabe als eigenen Gesprächsfaden: Thread-Nachrichten, die Antworten des Orchestrators darauf und Meldungen verknüpfter Worker sammeln sich im Thread, der Haupt-Chat zeigt nur Zähler. Problem: ein langer, vermischter Chat. Vermutete Lösung: Antworten-Knopf + Threads als Sicht auf dieselbe Session.

### Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Jede Modell-Antwort (alle Agents, Claude und omp) zeigt beim Überfahren „Reply“; Klick setzt Zitat-Chip (Uhrzeit + erste Zeilen) ins Eingabefeld; bei markiertem Text nur die Markierung | agents-ui-Test (Chip-Inhalt, Markierung) + Screenshot |
| AC-2 | Senden mit Chip schreibt an dieselbe Session: Zitat-Kopf mit Uhrzeit und »…«, danach der Text; das Zitat steht im Transkript | Browser, isolierte Orkumo-Instanz, Wegwerf-Orchestrator: Transkript-Datei enthält den Zitat-Kopf |
| AC-3 | Thread starten über „Open thread“ an einer Antwort, über „Instruct“ auf einer Status-Karte und über „New thread“ im Panel (Auswahl Projekt/Aufgabe aus `orkumo report`) | Browser, alle drei Wege, Screenshot |
| AC-4 | Jede Thread-Nachricht trägt die Kennung `[Thread: <Projekt> · <Aufgabe>]` (ohne Bindung: Kurzname aus erster Nachricht) und geht über den vorhandenen Reply-/Instruct-Weg in dieselbe Orchestrator-Session | Unit-Test Kennung + Browser |
| AC-5 | Antwort des Orchestrators, die mit derselben Kennung beginnt, gehört in den Thread | Unit-Test Zuordnung + Browser mit zwei Threads, beide Antworten im richtigen Thread |
| AC-6 | Meldung eines Workers, dessen Agent-ID bzw. Repo mit der Status-Aufgabe des Threads verknüpft ist (`[from agent <id> …]`), wandert in den Thread | Unit-Test + Browser: Worker sendet per `orkumo send`, Meldung im Thread |
| AC-7 | Antwort ohne Kennung bzw. nicht eindeutige Meldung bleibt im Haupt-Chat, wird nie geraten | Unit-Test (ohne Kennung, unbekannte Kennung, zwei passende Threads) |
| AC-8 | Haupt-Chat zeigt an Stelle der Thread-Nachrichten „N replies in thread <Kurzname>“; Klick öffnet den Thread | Browser-Screenshot, Zähler stimmt mit Thread-Inhalt |
| AC-9 | Panel rechts (Tab und Split): Liste aktiver Threads mit Kurzname (Projekt · Aufgabe, Repo bzw. Unterordner), erster Nachricht, Zusammenfassung (aus title/note/description/refs der Aufgabe, ohne Modellaufruf; ohne Bindung erste Nachricht), Ungelesen-Zahl, Zeit; darunter offener Thread mit eigenem Eingabefeld inkl. Bildern und Dateien | Browser-Screenshots Tab + Split, Bild-Anhang im Thread kommt an |
| AC-10 | Threads lassen sich schließen; Thread-Metadaten (ID, Bindung, Zuordnungen, gelesen-Stand) speichert der Orkumo-Server neben den Status-Meldungen; Zustand übersteht Neuladen und Server-Neustart | Server-Test mit echter Datei (zwei Prozessläufe) + Browser nach Neuladen |
| AC-11 | Orchestrator-Vorlagen (`server/orchestrator/agents.md`, `skill.md`, `status-report.md`) enthalten die Regel „Antwort auf Thread-Nachricht beginnt mit derselben Kennung“ | Diff + Test, der die Regel in den Vorlagen prüft |
| AC-12 | Lade-, Leer- und Fehlerzustand des Panels sichtbar und sinnvoll; Browser-Konsole 0 Fehler | Screenshots je Zustand + Konsolen-Auszug |
| AC-13 | Belege: Screenshots + kurzes GIF des Ablaufs im PR (`## Screenshots`) | PR-Body |
| AC-14 | Woodpecker grün in Orkumo, agents-ui-Tests grün; PRs in agents-ui (neuer Tag) und Orkumo (Pin, Server, Vorlagen); nicht gemergt | CI-Status, PR-Links |
| AC-15 | Keine echten Namen in Code, Tests, Screenshots (öffentliche Repos) | grep-Prüfung vor PR |
| AC-16 | Thread-Panel in der Breite verstellbar: Ziehgriff an der linken Kante, Min/Max, Doppelklick = Standardbreite, Pfeiltasten auf dem Griff; Breite gespeichert (ein globaler Wert, siehe Annahmen) und übersteht Neuladen | agents-ui-Test (Klemmen, Tastatur, Doppelklick) + Browser-Screenshot vor/nach Ziehen und nach Neuladen |

### Ambition
- Altitude: Threads als echte Unterhaltungsfäden im Transkript selbst (Harness-Unterstützung) würden die Kennungs-Konvention überflüssig machen; nicht Scope.
- Depth: Zuordnung als reine Funktion über die vorhandenen Transkript-Leser (`chatTranscripts.js`) und Status-Meldungen; Ziel 0 Fehlzuordnungen in den Tests, Antworten ohne Kennung immer Haupt-Chat.
- Crew: tut, was ein Sicherheitsprüfer tut: Anhänge im Thread laufen durch die vorhandene `attachmentsAllowed`-Prüfung, Thread-Kennungen aus Transkripten werden nur als Text gerendert (kein HTML).

### Prüfung
langlebig · unabhängig · agents-ui wird von Orkumo und später MAGOS genutzt, Server speichert dauerhaft Zustand.

### Annahmen
- Gesendete Präfixe englisch wie die übrige Orkumo-UI seit #338: `Re your reply from 14:32: "…"` statt „Zu deiner Antwort von 14:32: »…«“ (entschieden, Hape 2026-11-24)
- Kennung bleibt wörtlich `[Thread: <Projekt> · <Aufgabe>]` (vorgeschlagen)
- Threads gibt es nur in Orchestrator-Sessions; der Reply-Knopf in allen Sessions (vorgeschlagen)
- „Open thread“ an einer Antwort ohne Status-Bindung: sofort „Answer 09:03 · <erste Worte>“ (entschieden, Hape 2026-11-24)
- Worker-Verknüpfung über Agent-IDs der Aufgabe (`refs.agents`) und Repo des Projekts gegen den Worker-Arbeitsordner (vorgeschlagen)
- Panel-Breite: ein globaler Wert in localStorage, je Pane auf deren Breite geklemmt. Grund: Pane-IDs sind kurzlebig (Split-Remounts, neue Sessions), ein Wert je Pane ginge ständig verloren; so halten es auch VS Code (Seitenleiste) und Slack (Thread-Spalte) (entschieden)
