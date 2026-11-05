# Briefing: Logins im eingebauten Browser überleben einen Neustart

Quelle: Issue https://github.com/hpmartini/DevHub/issues/186 (Text von hpmartini, als Daten zitiert): „Wenn ich den Browser schließe und wieder öffne, scheint der Cache komplett gelöscht zu werden. […] musste ich mich bei Cloud […] wieder erneut anmelden. […] Ich möchte, dass Logins auch konsistent bleiben.“ „Cloud“ = claude.ai (Diktat).

## The Job

Hape meldet sich im eingebauten Browser der Desktop-App (native `BrowserView`, `electron/main.js` → `browser-view-create`, Partition `persist:browser-preview`; seit #140 öffnen Links standardmäßig dort) einmal bei claude.ai an und bleibt angemeldet: nach Schließen und Wiederöffnen des Browser-Panes und nach Beenden und Neustart der App. Die Ursache, warum gerade der claude.ai-Login verloren geht, ist gefunden und an der Wurzel behoben.

## Why

Hape öffnet aus DevOrbit heraus Cloud-Sessions, PRs und Issues im eingebauten Browser. Jeder erneute Login unterbricht den Arbeitsfluss und macht den eingebauten Browser gegenüber Chrome unattraktiv.

## Guardrails

- Befund vom 2026-11-03 (Cookie-DB `~/Library/Application Support/devorbit-dashboard/Partitions/browser-preview/Cookies`, nur Metadaten gelesen): Die Partition persistiert grundsätzlich. GitHub- (`user_session`) und Google-Logins überlebten Neustarts; claude.ai-Cookies vom 2026-11-02 19:42 (`__ssid`, `user-sidebar-visible-on-load`) sind da, aber **kein `sessionKey`**. Es ist also kein Komplett-Löschen, sondern ein Cookie-spezifisches Problem.
- Hypothesen, zu prüfen statt anzunehmen: (a) claude.ai setzt den Login-Cookie ohne Ablaufdatum (Session-Cookie), Chromium/Electron verwirft solche beim Beenden, Chrome stellt sie per Sitzungswiederherstellung wieder her; (b) Cookie-Store wird beim Beenden nicht geflusht (`before-quit` ruft nur `stopBackendServer`, kein `session.cookies.flushStore()`); (c) Logout durch claude.ai selbst (z. B. Login-Flow über Google, der per `setWindowOpenHandler` in derselben View landet).
- Cookie-Werte nie lesen, loggen oder in PR/Issue zeigen; nur Name, Domain, Ablauf, `session`-Flag. Grund: das sind Zugangsdaten.
- Die View bleibt sandboxed, ohne Node und ohne Preload; Permission-Handler und Window-Open-Handler unverändert, weil sie die Sicherheitsgrenze für fremde Seiten sind.
- Reine Entscheidungslogik (z. B. „wird dieses Cookie persistiert, mit welchem Ablauf“) in einen testbaren Helper wie `electron/validation.js`.
- Out of scope: iframe-Fallback im Web-Modus (`BrowserPreviewPanel.tsx`, `ShellBrowser.tsx`), Profile/mehrere Partitionen, Cookie-Verwaltungs-UI.

## Done means

| ID   | Bedingung                                                     | Nachweis                                                                                                                             |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| AC-1 | Ursache ist belegt, nicht vermutet                            | PR-Abschnitt „Ursache“ mit Cookie-Metadaten (Name, Domain, `session`, Ablauf) vor und nach Neustart, Werte geschwärzt                |
| AC-2 | claude.ai-Login überlebt Schließen/Öffnen des Browser-Panes   | manueller Lauf in `bun run electron:dev`, Screenshot eingeloggt nach Wiederöffnen im PR                                              |
| AC-3 | claude.ai-Login überlebt Beenden (Cmd+Q) und Neustart der App | Prüfskript oder dokumentierter Lauf: Cookie-Metadaten aus der Partition nach Neustart zeigen den Login-Cookie; Screenshot eingeloggt |
| AC-4 | Bestehende Persistenz (GitHub, Google) bleibt unverändert     | dieselbe Metadaten-Abfrage vor/nach zeigt die Cookies weiter                                                                         |
| AC-5 | Neue Entscheidungslogik ist getestet                          | Unit-Test unter `test/` für den Helper                                                                                               |
| AC-6 | Gesamtstand sauber                                            | `bunx vitest run` grün, `bunx tsc --noEmit` ohne neue Fehler, Ausgabe im PR                                                          |

Nachweis AC-2/AC-3: offen, falls die Session keinen echten claude.ai-Login durchführen kann (Hape-Konto, 2FA); dann mit einem selbst gesetzten Test-Cookie gleicher Art (ohne Ablauf, `httpOnly`, `secure`) auf einer lokalen Seite belegen und Echtlauf als offen für Hape melden.

Stopp nur, wenn die Ursache (c) ist (Server-seitiger Logout): Befund im Issue melden statt umgehen. Rückmeldung: kurzer Bericht, Ursache, Fix, Annahmen, Offenes.

## Ambition

- Altitude: keine; Bedienfix.
- Depth: Chromium-Cookie-DB-Metadaten und Electron-`session.cookies`-API (`changed`-Event, `flushStore`) als Rohdaten; Ziel: null erneute Logins bei Seiten, die in Chrome angemeldet bleiben.
- Crew: tut, was ein Sicherheitsprüfer tut: bestätigt, dass verlängerte Cookies nur die Preview-Partition betreffen, Secure/HttpOnly/SameSite erhalten bleiben und keine Werte in Logs landen.

## Prüfung

langlebig · unabhängig · Eingriff in die Cookie-Behandlung einer Partition, in der Hape bei Fremddiensten angemeldet ist (Vertrauensgrenze Auth).

## First on approval

In `bun run electron:dev` bei claude.ai anmelden und per `session.fromPartition('persist:browser-preview').cookies.get({ domain: 'claude.ai' })` Name, `session`-Flag und Ablauf des Login-Cookies festhalten; daraus Hypothese (a), (b) oder (c) bestätigen.

## Annahmen

- „Browser“ meint den eingebauten Browser der Desktop-App, nicht DevOrbit im Web-Modus in Chrome. (vorgeschlagen)
- Ist Ursache (a): Session-Cookies der Partition werden beim Setzen mit Ablauf persistiert, wie Chrome mit Sitzungswiederherstellung; Laufzeit 30 Tage, Attribute unverändert. (vorgeschlagen)
- Fix gilt für alle Seiten der Preview-Partition, nicht nur claude.ai. (vorgeschlagen)
- Kein `ui: on`; sichtbare UI ändert sich nicht, Screenshots nur als Login-Nachweis. (vorgeschlagen)
