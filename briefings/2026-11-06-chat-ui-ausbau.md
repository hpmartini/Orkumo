# Chat-Ansicht ausbauen (#189 Folge)

## The Job

Chat pane (`claude -p` stream-json) so nutzbar wie die TUI: immer unten, Chat als Standard beim Öffnen,
Zwischenschritte aus dem Verlauf raus (Arbeitsfenster über der Eingabe, eingeklappt), Recaps sichtbar,
Composer (Mehrzeilig, Verlauf mit Pfeil hoch, Home, Listen, Tab/Shift+Tab), `/`-Liste mit Details,
`@` für Dateien und Agents, Statuszeile (Branch, Git-Status, Cache, Kontext, 5h/7d), Plan mit Haken,
laufende Shells und Sub-Agents einsehbar, Bilder bleiben in gesendeten Nachrichten sichtbar.

## Why

Hape soll Agents im Browser statt im Terminal führen können, ohne Information zu verlieren.

## Guardrails

- Kein API-Key, nur Abo. CLI unverändert, nur stream-json.
- Laufende Turns nie unterbrechen: „Chat als Standard" wandelt nur idle Sessions um.
- Shell-Ausgaben nur für Pfade, die die Session selbst gemeldet hat (`…/tasks/<id>.output`).
- Bilder nur aus dem eigenen `agent-images`-Ordner ausliefern (UUID-Dateiname).

## Done means

Alle Punkte im Chat sichtbar, Tests für die reine Logik, `tsc` und vitest grün, App gebaut, installiert, neu gestartet.

## Annahmen (Rückfragen nicht möglich, Goal-Hook)

1. „Chat als Standard": neue Einstellung `agentOpenView` (Default `chat`). Klick auf eine idle Session
   mit bekannter Session-ID öffnet sie als Chat (Background-Job wird dafür gestoppt und im Chat
   fortgesetzt). Arbeitende Sessions öffnen weiter im Terminal. Umschaltbar in den Agent-Einstellungen.
2. Recaps (`※ recap`) schreibt die CLI als `system/away_summary` ins Transkript. Live in `-p` entstehen
   keine; sichtbar sind die aus dem Verlauf, plus `/recap` aus der Befehlsliste.
3. Built-in-Befehle laufen in `-p` (geprüft mit `/context`); die Liste kommt aus der CLI selbst.
4. Thinking/Tool-Calls: aus dem Chat raus, im Arbeitsfenster über der Eingabe (Default eingeklappt).
   Ein Schalter im Kopf blendet sie wieder im Verlauf ein.
5. Composer-Edits per Taste (Listen, Tab) setzen den Text kontrolliert: natives Undo greift dafür nicht.
6. Shells „reinspringen" = Ausgabe live ansehen (lesend). Eingaben in eine Background-Shell gibt es auch in der TUI nicht.
