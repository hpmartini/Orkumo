# Briefing: Landingpage für DevOrbit (Issue #37)

## The Job
Die Seite soll Besuchern in zehn Sekunden zeigen, was DevOrbit als ADE (Agentic Development Environment) anders macht: fünf Modi in einer Shell, verbunden über den Kontext Issue → Agent → Worktree → PR → Code, Agents auf allen Geräten. Danach soll sie die Besucher ins Repo `hpmartini/DevHub` führen, wo sie DevOrbit selbst starten.

Die Seite ist ein englischsprachiger, eigenständiger statischer Build in `landing/` und läuft auf GitHub Pages (`hpmartini.github.io/DevHub/`, keine eigene Domain). Abschnitte:
- Hero mit Kernsatz und Hintergrund, der auf die Maus reagiert (Shader oder Aceternity-Background).
- Die fünf Modi (Überblick, Board, Agents, Code, Terminal) als asymmetrisches Bento-Raster mit echten Screenshots.
- Die Kontext-Kette als animierte Darstellung.
- Mesh: Agents laufen auf ihrem Gerät, Remote ansehen und anhängen über Tailscale.
- Quickstart (`bun install`, `bun run dev:full`) mit Repo-Link.
- Footer.

## Why
Hape baut DevOrbit als seine komplette Arbeitsumgebung für agentische Entwicklung (Leitbild: `docs/VISION.md`). Das Repo ist public, hat aber kein Schaufenster. Der ursprüngliche Issue-Prompt (Next.js-Seite für eine KI-Agentur) ist überholt. Aus ihm gelten nur noch die Design-Vorgaben:
- dunkle Atmosphäre statt Flachfarben
- Bento-Raster und gestaffelte Reveals
- Hover-Effekte: magnetisch bzw. Tilt
- markante Schriften statt Inter, Roboto oder Systemschrift
- keine generischen „AI-Slop“-Muster

## Guardrails
- Design mit `/impeccable`, Komponenten mit `/demo-skills:aceternity-ui` (`@aceternity`-shadcn-Registry, nur freie Komponenten). Hape will es so.
- Build mit Bun, nicht Vite, weil das Repo auf Bun läuft.
  - HTML-Entry `landing/index.html`. Dev mit `bun landing/index.html`, Prod mit `bun build … --outdir dist-landing`.
  - Tailwind v4 über `bun-plugin-tailwind`.
  - Scripts `landing:dev` und `landing:build` in `package.json`.
- Die App bleibt unberührt, weil die Seite die Shell nicht verändern darf. Das betrifft `App.tsx`, das Routing (`/` → `/agents`), `index.html` mit dem Tailwind-CDN, `vite.config.ts` und `components/`. shadcn- und Aceternity-Dateien landen unter `landing/`.
- Neue Dependencies nur für tatsächlich genutzte Bausteine. `motion`, `three` und `lucide-react` sind schon da.
- Screenshots aus `docs/screenshots/` übernehmen oder neu aufnehmen. Darauf dürfen keine privaten Pfade, Tokens oder Kundennamen zu sehen sein, weil die Seite öffentlich ist.
- Deploy über `.github/workflows/pages.yml`: Build von `landing/` und Veröffentlichung bei Push auf `main`. Asset-Pfade müssen unter `/DevHub/` laden.
- Alter Branch `claude/issue-37-20260110-0840` ist nur Ideenquelle, nichts mergen. Er verbiegt das App-Routing.
- Mobile first. `prefers-reduced-motion` respektieren. WebGL lazy laden.
- Höchstens 3 Subagents.

## Done means
| ID | Bedingung | Nachweis |
| --- | --- | --- |
| AC-1 | Prod-Build der Landingpage entsteht fehlerfrei mit Bun | Ausgabe von `bun run landing:build`, `dist-landing/index.html` vorhanden |
| AC-2 | App bleibt unverändert und grün | `git diff origin/main --stat -- App.tsx index.html vite.config.ts components/` leer; `bun run build`, `bun run test:run`, `bun run lint` mit demselben Ergebnis wie auf `origin/main` |
| AC-3 | Alle sechs Abschnitte vorhanden, alle fünf Modi mit echtem Screenshot | Screenshots der ganzen Seite bei 375 px und 1440 px im PR |
| AC-4 | Schnell und barrierearm (mobil) | Lighthouse-CLI gegen den lokal ausgelieferten Prod-Build (Mobile): Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95, JSON-Report im PR |
| AC-5 | Lesbar ohne Bewegung | Playwright-Screenshot mit `reducedMotion: 'reduce'`: alle Inhalte sichtbar, kein WebGL-Canvas |
| AC-6 | Design-Qualität gemäß Skill | Bericht der `/impeccable`-Prüfung im PR: keine offenen schweren Befunde, keine verbotenen Schriften (Grep in `landing/` nach Inter, Roboto, Open Sans leer) |
| AC-7 | Läuft unter dem Pages-Pfad `/DevHub/` | Build mit Base `/DevHub/` lokal ausgeliefert, Network-Log ohne 404; `actionlint .github/workflows/pages.yml` ohne Befund |
| AC-8 | Live auf GitHub Pages | Nachweis: offen, weil Deploy erst nach Merge auf `main` läuft und Pages ggf. in den Repo-Settings aktiviert werden muss; Schritt steht in der Review-Anleitung |
| AC-9 | Keine sensiblen Daten in den Screenshots | Sichtprüfung jeder Bilddatei in `landing/` mit Liste im PR (Datei → geprüft, nichts Privates) |

## Ambition
- Altitude: Die Seite könnte später als `README`-Hero und Release-Seite für die Desktop- bzw. iOS-App dienen. Nur Vorschlag, nicht im Scope.
- Depth: Echte Screenshots statt Mockups. Lighthouse und Playwright als Messwerkzeuge. Zielwerte: LCP < 2,5 s mobil, JS-Bundle des ersten Ladens < 250 KB gzip, Three.js nur lazy.
- Crew:
  - Tut, was ein Accessibility-Prüfer tut: Fokusreihenfolge per Tastatur durchgehen, Kontraste der Neon-Akzente auf Dunkel messen.
  - Tut, was ein Copywriter tut: Hero-Satz und Modus-Texte auf einen konkreten Nutzen pro Zeile kürzen, ohne Buzzwords.

## Prüfung
wegwerf · selbst · Statische Marketingseite ohne Vertrauensgrenzen, von der kein anderes System abhängt, und die App bleibt unberührt.

## First on approval
`/impeccable` mit diesem Briefing starten, um Designrichtung und Abschnitte festzulegen. Danach passende Aceternity-Komponenten aus `references/catalog.md` des Skills wählen.

## Annahmen
- Build mit Bun-Bundler. Scheitert Bun nachweislich an einem Aceternity- oder Shader-Baustein, ist ein Fallback auf Vite erlaubt, mit Grund im PR. (vorgeschlagen)
- Projektseite unter `hpmartini.github.io/DevHub/`, keine eigene Domain. (vorgeschlagen, von Hape bestätigt)
- Englische Texte, Markenname „DevOrbit“. Repo-Name „DevHub“ nur in Links. (vorgeschlagen)
- Neue Screenshots dürfen mit Demo-Daten aufgenommen werden, wenn die vorhandenen private Inhalte zeigen. (vorgeschlagen)
