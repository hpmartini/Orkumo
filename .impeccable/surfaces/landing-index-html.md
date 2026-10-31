---
version: 1
slug: 'landing-index-html'
primary_target: 'landing/index.html'
related_targets: []
---

# Surface brief: landing page

Scope: `landing/` (public product page for DevOrbit, GitHub Pages `/DevHub/`). Mode: Persuade. Redesign 2 (Hape, 2026-10-31): v1 synth rack rejected as half-hearted; cable arcs read as railings. Keep the real app screenshots. Optimise for conversion, explain every feature properly.
Audience: developers juggling parallel coding agents. Action: get DevOrbit running: download the desktop pre-release (dmg / AppImage / deb / rpm from GitHub Releases) or run from source (quickstart commands, copyable). Secondary: open the repo.
Proof: real screenshots in `landing/img/` (already privacy-checked), the real context chain, real commands, real release assets. No invented stars, users, benchmarks, pricing or licence claims.
Constraints: brief-pinned dark atmosphere, asymmetric bento, staggered reveals, tilt or magnetic hover, distinctive type (no Inter/Roboto/Open Sans/system display). Bun build, Tailwind v4, Motion, Aceternity registry components allowed. Lighthouse mobile perf >= 85, a11y/BP/SEO >= 95. No WebGL canvas.
Decision: attended goal run, direction assigned by the roll and built unattended (user asked for autonomous execution); implementation delegated to MiniMax, review by Codex. Code-led, no comps.

## Direction contract

THESIS: DevOrbit is the shop-floor planning board for agent work: every task is a T-card that travels one rail, Issue → Agent → Worktree → PR → Code, and an andon light tells you which agent needs you. Refuses the dev-tool default of a neon headline over equal feature cards and the v1 synth-rack costume.

OWN-WORLD: Night shift on a factory planning wall. Ground: deep powder-coated steel, blue-black (#0B0F14 to #121821) with a faint brushed grain and hairline slot rails. T-cards in real card-stock colours that own whole regions when they appear: signal yellow #F5C518, salmon #FF8A65, mint #7FE0B5, sky #7DB8FF, white #F2F0EA; black keyline ink on cards. Andon stack lights: red #FF3B30 = needs input, amber #FFB020 = working, green #3DDC84 = ready for review, used only as status. Column headers as embossed label tape (raised off-white caps on black or red tape). Display face Big Shoulders Display (condensed industrial, heavy), body Archivo, JetBrains Mono only for commands, paths and IDs. Cards sit in slots with soft offset shadows, never glow.

STORY: In one viewport the visitor sees a task card already moving across the board and the andon on its agent turning red, understands "DevOrbit keeps issue, agent, branch, PR and code on one card", and has the download and quickstart in reach. Scrolling, the same card walks the five slots while each step shows the real mode screenshot that slot opens; then every mode is explained with what you actually do in it, the mesh across machines, requirements, FAQ, and a final close with download + commands.

FIRST VIEWPORT: Top: thin steel header rail with wordmark left, links (How it works, Modes, Mesh, Install), GitHub link right. Left 6/12: headline in Big Shoulders at clamp(3rem,7vw,6rem) "Every agent task on one card.", one sentence, primary button "Download for macOS" (detects OS, falls back to all builds) plus copyable `git clone … && bun run dev:full` strip directly under it as the working form of the action; tiny line "Pre-release · macOS, Linux · open source on GitHub". Right 6/12: a planning board fragment with five labelled slots (ISSUE, AGENT, WORKTREE, PR, CODE); one yellow T-card "#142 Add retry to webhook" sits in AGENT with the red andon blinking, synthetic data labelled as example.

FORM: Shop-floor T-card planning board with andon lights, position 3 of 7 on the grounded list (1 git transit map, 2 signal-box mimic panel, 3 T-card planning board, 4 split-flap departure board, 5 exploded patent drawing, 6 film call sheet, 7 postal routing labels). seed:bb759b78cfc331cc. Raises: from the brick build instructions (declined), each workflow step ghosts the prior state and the newly linked item arrives bright with an arrow to its slot; from the VU-meter bridge (declined), repeated identical units (slots, mode rows) act as the page's ruler so the rhythm stays strict. Signature interaction: scroll-driven card walk (sticky board; the card slides slot to slot; andon red → amber → green; mode screenshot swaps per slot); reduced motion shows the five steps as a static ghosted sequence.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
