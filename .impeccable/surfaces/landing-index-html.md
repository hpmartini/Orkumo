---
version: 1
slug: 'landing-index-html'
primary_target: 'landing/index.html'
related_targets: []
---

# Surface brief: landing page

Scope: `landing/` (public product page for DevOrbit, GitHub Pages `/DevHub/`). Mode: Persuade. Redesign 3 (Hape, issue #37 comment 2026-11-02): v2 T-card board rejected. Yellow does not fit the app screenshots; hero title and subtitle too abstract; the planning board appeared twice (hero and how-it-works); Code came after the PR; nobody cares about worktree creation at that point. The USP to sell: plan, steer, monitor, review and edit agent work in one unified, structured, clear interface that makes orchestrating dozens of projects and even more agents possible without switching apps. Feature callouts: terminal first, live workflow visualisation (Pro), VS Code embedded, browser embedded. UI/UX, copy (SEO and conversion), structure through impeccable.
Audience: developers running many coding agents across many repositories. Action: download the desktop pre-release or run from source (copyable quickstart). Secondary: open the repo.
Proof: abstracted interactive demos of the real app screens in `landing/demos/` (board, agents, pulls, code; synthetic data, replaced the screenshots per owner request 2026-11-02), real commands, real release assets. Terminal, browser, monitor and workflow have no shippable capture: HTML/SVG illustrations, visibly labelled "Illustration". Pro is a label only, no price. No invented stars, users, benchmarks or pricing.
Copy: owned by `landing/copy.ts`; every string grounded in README/code.
Constraints: dark atmosphere, distinctive type, Bun build, Tailwind v4, Motion. Lighthouse mobile perf >= 85, a11y/BP/SEO >= 95. No WebGL.
Decision: decision page served (key f94ca61c); no answer within the prep window, so the assigned roll was built. Implementation delegated to MiniMax, review by Codex. Code-led, no comps.

## Direction contract

THESIS: DevOrbit is the line control room for agent work: every project is a line, every agent a train on it, and one diagram shows where all of them are and which one is waiting for you. Plan, Steer, Monitor, Review and Edit are the stations, Edit loops back off Review. Refuses the dev-tool default of a neon headline over equal feature cards, and the yellow shop-floor costume of v2.

OWN-WORLD: A metro operations control centre at night, matched to the app itself. Ground is the app's own navy, measured from the screenshots (#26365F / #22335E), deepened for the page: ground #172340, panel #1E2C50, raised #26365F, hairline #34497A. Text #E8EEFA, secondary #A8BBE2. Primary is the app blue: #3B82F6 for marks and track, #2563EB behind white button text, #60A5FA for links. Line colours are the app's label colours and only mark lines and states: emerald #34D399 (ready), amber #FBBF24 (working), rose #FB7185 (needs input), violet #A78BFA. Track is straight with 45-degree turns only, never arcs; stations are white-filled ticks with a dark keyline. Display face Overpass (highway signage), body Archivo, JetBrains Mono only for commands and paths. Screens are interactive abstractions of the app, framed as monitors on the control-room wall.

STORY: In the first viewport the visitor reads the concrete promise (plan, steer and review dozens of agents in one window), sees four project lines running through Plan, Steer, Monitor, Review and Edit with trains moving and one train halted rose at Steer, and has download and quickstart in reach. Scrolling: the five jobs, each a full-width row with an interactive demo of that station; then the workspace (terminal first, VS Code and browser built in) as one composite; then the live workflow graph (Pro); then scale across projects and machines, principles, install, FAQ, close.

FIRST VIEWPORT: Header: wordmark left, links Features, Terminal & IDE, Workflow, Install, FAQ, GitHub right. Left 6/12: H1 in Overpass, clamp(2.6rem, 5.4vw, 4.75rem), "One workspace. Every agent.", one short verb line "Plan · Orchestrate · Review · Ship", primary button "Download for macOS" (OS-detected, blue-600) and secondary "Run from source", copyable quickstart directly under it, note line. Right 6/12: the line diagram: five station columns labelled Plan, Steer, Monitor, Review, Edit; four horizontal lines (storefront, billing-api, docs-site, mobile-app; labelled "Example projects"); Edit drawn as a short 45-degree spur back from Review; trains as rounded capsules; the focused station (Steer, with the rose train) is the brightest thing, the rest dimmed.

FORM: Metro operations control centre, live line diagram, position 3 of 7 on the grounded list (1 broadcast multiviewer, 2 mission control MOCR, 3 metro line diagram, 4 ATC strip bay, 5 orchestral full score, 6 tiling window manager, 7 kitchen expo pass). seed:8a3e4d18ce910c95. Raises: from the cutting-bench rail (declined), state is a mark as well as a hue (needs input = hollow ring, working = half, ready = filled); from the fight poster (declined), rank by type size alone, one H1 at full scale and everything else visibly smaller; from the luminescent understory (declined), the focused station is the brightest thing on screen while the rest dims. Signature interaction: trains advance station to station on the hero diagram; the rose train waits at Steer until it pulses once and moves on; reduced motion shows a static snapshot.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
