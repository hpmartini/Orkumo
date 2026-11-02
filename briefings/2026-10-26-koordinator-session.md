# Briefing: Koordinator-Session (Premium)

## The Job

DevHub bekommt einen dauerhaft laufenden Koordinator: eine Claude-Code-Hintergrund-Session (`claude --bg`). Hape gibt ihr per Chat Anweisungen: Issues und Projekte anlegen und bearbeiten, Board-Spalten setzen, mw-Läufe starten, steuern und freigeben, Überblick über Repos, Issues, PRs und Agents liefern. Am Ende existieren:

- **Premium-Trennung:** privates Repo `hpmartini/DevHub-pro`. Das öffentliche DevHub lädt es als optionales Modul, falls es vorhanden ist; ohne Modul fehlt das Feature spurlos.
- **Koordinator-Workspace** im Premium-Repo: eigene `CLAUDE.md`, `.claude/skills/{issues,board,mw,overview}` (klein, je eine Aufgabe), `settings.json` mit Allowlist, Hooks nach dem Muster `~/PROJECTS/Maple/workspace-templates/claude`.
- **Chat-Overlay** in der gemeinsamen Shell: Markdown-Rendering, Bild- und Datei-Upload mit Vorschau. Ein globaler Shortcut (Electron `globalShortcut`) öffnet es von überall.
- **MW-Steuerung** über die `mw`-CLI (`board`, `run`, `status`, `approve`).
- **RocketChat-Bridge:** Nachrichten aus RocketChat gehen an denselben internen Endpunkt wie der Web-Chat, Antworten kommen dorthin zurück.

## Why

Hape steuert viele Projekte und Agents parallel. Der Koordinator soll sein zentraler Ansprechpartner sein, vom Schreibtisch und unterwegs, ohne dass er Board, Terminal und GitHub einzeln bedienen muss. Er ist das erste Premium-Feature von DevHub; weitere (z.B. nahtlose mw-Plugin-Integration) docken an dieselbe Modul-Schnittstelle an. Diese Schnittstelle muss also tragen.

## Guardrails

- Reihenfolge: Premium-Trennung zuerst, weil `hpmartini/DevHub` public ist (PolyForm Noncommercial); kein Koordinator-Code im öffentlichen Repo. Danach Kern + Chat + Shortcut, dann MW, dann RocketChat.
- Session-Modell: Dauer-Session per `claude --bg`, geführt über das vorhandene `server/services/agentService.js` und in der Agents-Ansicht sichtbar und anhängbar. Kontext bleibt unter ~200k: Wissen liegt in Postgres, Files und `graphify-out/` und wird über Skills nur bei Bedarf geholt. Vor der Grenze schreibt die Session eine Übergabe (Stand, offene Aufträge) in die DB und wird durch eine frische ersetzt. Option: Einzelnachricht im zustandslosen MAPLE-Modus (`claude -p` + Kontextpaket, vgl. `Maple/scripts/maple-antwort.mjs`).
- Befugnis ohne Rückfrage: Issues anlegen/bearbeiten, Labels, Board-Spalten, mw-Läufe starten und freigeben. Mit Rückfrage im Chat: Issues schließen, mergen, Sessions löschen, alles auf `main`. Durchsetzen über `settings.json`/Hooks, nicht nur per Prompt.
- Nur Abo, nie `ANTHROPIC_API_KEY`, nur das unveränderte `claude`-Binary (VISION P4).
- Bestehendes nutzen: Board-API, Agents-API, Postgres/Drizzle, Redis. Keine neue DB, kein paralleles Agent-Register. Upload-Sicherheit (MIME-Whitelist, Größenlimit, Traversal-Guard) nach `Maple/server/maple-chat.js`.
- Abhängig von #95, #104, #105, #87: deren APIs nutzen, nichts doppelt bauen. Fehlt etwas, Lücke als Issue melden.
- VISION P3: Chat ist Overlay der einen Shell. Jede Funktion nennt, welche Kontext-Verknüpfung sie liest oder schreibt.
- Höchstens 4 Subagenten gleichzeitig.
- Annahme: Es gibt eine erreichbare RocketChat-Instanz. Fehlt sie, Bridge gegen einen lokalen Docker-RocketChat bauen und testen.
- Annahme: Lizenzschlüssel und Lizenzserver kommen später. v1 erkennt Premium nur daran, ob das Modul vorhanden ist.

## Done means

- Ohne Premium-Modul: öffentlicher Build und Tests grün, kein Koordinator-UI, `grep` findet keinen Koordinator-Code im public Repo.
- Mit Modul: Test schickt „lege Issue X mit Label Y an“ über den Chat-Endpunkt, `gh issue view` zeigt es. Dieselbe Nachricht über RocketChat führt zum gleichen Ergebnis und bekommt eine Antwort.
- Eine mw-Anweisung startet einen Lauf; `mw status` zeigt ihn.
- Eine verbotene Aktion (z.B. mergen) erzeugt eine Rückfrage statt Ausführung.
- Test belegt die Rotation: simulierter Kontext über der Schwelle → Übergabe gespeichert, neue Session übernimmt.
- Playwright/Electron-Test: Shortcut öffnet das Overlay, Bild-Upload zeigt eine Vorschau, Markdown wird gerendert.
- Bestehende Agents-, Board- und Terminal-Funktionen unverändert.
- Weiterarbeiten, außer bei fehlendem Zugriff auf das Premium-Repo oder die RocketChat-Instanz.
- Rückmeldung: kurzer Bericht, was gebaut, welche Annahmen, PR-Links je Stufe.

## First on approval

Privates Repo `hpmartini/DevHub-pro` anlegen und im öffentlichen DevHub den Lademechanismus für optionale Premium-Module mit leerem Platzhalter-Modul bauen.
