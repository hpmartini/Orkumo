---
version: 1
slug: 'landing-index-html'
primary_target: 'landing/index.html'
related_targets: []
---

# Surface brief: landing page

Scope: `landing/` (public product page for DevOrbit, GitHub Pages `/DevHub/`). Mode: Persuade.
Audience: developers juggling parallel coding agents. Action: open the repo and run DevOrbit locally (quickstart is the working form of the action).
Proof: real screenshots from `docs/screenshots/`, the real context chain, real commands. No invented stars, users or benchmarks.
Constraints: brief-pinned dark atmosphere with neon accents, asymmetric bento, staggered reveals, tilt/magnetic hover, no Inter/Roboto/system faces. Bun build, Tailwind v4, Aceternity registry components, Lighthouse mobile perf >= 85.
Decision: unattended run (mw board); assigned direction built, no decision page shown. Code-led, no comps.

## Direction contract

THESIS: DevOrbit is a modular synth for agentic development: every mode is a module in one rack, and the context is the patch cable running Issue → Agent → Worktree → PR → Code. Refuses the category default of a centered headline over a row of equal feature cards.

OWN-WORLD: Anodised black Eurorack case (#07080B ground, faint grain, rack rails with screw holes). Modules are graphite panels of different HP widths with silkscreened labels in expanded heavy grotesk (Archivo, wdth 125, wght 800) and small JetBrains Mono jack labels. Patch cables in signal colours: electric blue #3B82F6, violet #8B5CF6, acid green #A3E635; one scarlet LED (#FF3B30) marks the live element only. Jacks are drawn rings; LEDs glow with offset soft shadows.

STORY: Visitor sees one rack where cables already link an issue to an agent, a worktree, a PR and code, understands "everything is connected by context", sees each mode as a real screenshot module, learns agents stay on their own machines across the tailnet, and copies two commands to run it.

FIRST VIEWPORT: Left 5/12: headline "Patch your agents into one context." at clamp(3rem,7vw,6rem), one sentence, primary button "Run it locally" scrolling to quickstart, secondary "View on GitHub". Right 7/12: a rack with five jacks labelled ISSUE, AGENT, WORKTREE, PR, CODE joined by sagging SVG cables that sway toward the pointer; one scarlet LED on AGENT. Nav strip on top as rack rail.

FORM: Modular-synth patch rack, position 4 of 7 on the grounded list (1 transit map, 2 orbital telemetry, 3 flight progress strips, 4 modular patch rack, 5 film edit timeline, 6 orchestral score, 7 railway signal box). seed:93eed6297372855c. Raises: from the collider event display (declined), selecting a jack isolates its cable chain and dims the rest; from the neo-tokyo neon night (declined), one scarlet accent reserved for the single live element.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
