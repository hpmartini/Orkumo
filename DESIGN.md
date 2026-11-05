---
name: Orkumo Landing (landing/)
description: Design system of the public landing page in landing/ only; the root React app is not covered.
colors:
  app-blue: '#3b82f6'
  action-blue: '#2563eb'
  action-blue-deep: '#1d4ed8'
  link-blue: '#60a5fa'
  line-emerald: '#34d399'
  line-amber: '#fbbf24'
  line-rose: '#fb7185'
  line-violet: '#a78bfa'
  ground: '#172340'
  panel: '#1e2c50'
  raised: '#26365f'
  hairline: '#34497a'
  band: '#141f3a'
  monitor-well: '#101a33'
  pane-well: '#0c152b'
  keyline: '#0d1526'
  text: '#e8eefa'
  muted: '#a8bbe2'
  line-label: '#c9d6f0'
  plate-white: '#ffffff'
typography:
  display:
    fontFamily: 'Overpass Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: 'clamp(2.6rem, 5.4vw, 4.75rem)'
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: '-0.012em'
  headline:
    fontFamily: 'Overpass Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: 'clamp(1.9rem, 3.6vw, 3rem)'
    fontWeight: 700
    lineHeight: 1.06
    letterSpacing: '-0.012em'
  headline-close:
    fontFamily: 'Overpass Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: 'clamp(2.1rem, 4.4vw, 3.5rem)'
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: '-0.012em'
  title:
    fontFamily: 'Overpass Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '24px'
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: '-0.012em'
  title-sm:
    fontFamily: 'Overpass Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '18px'
    fontWeight: 700
    lineHeight: 1.556
    letterSpacing: '-0.012em'
  lead:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '18px'
    fontWeight: 400
    lineHeight: 1.556
  body:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.5
  station:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '15px'
    fontWeight: 700
  body-sm:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '13px'
    fontWeight: 400
  note:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.333
  micro:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '11px'
    fontWeight: 600
  label:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 600
    letterSpacing: '0.12em'
  mono:
    fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: '24px'
  mono-sm:
    fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: '24px'
rounded:
  svg-xs: '2px'
  chip: '3px'
  plate: '4px'
  control: '5px'
  inset: '6px'
  monitor: '8px'
  panel: '10px'
  pill: '9999px'
spacing:
  gutter: '20px'
  gutter-wide: '36px'
  panel: '24px'
  rail-inset: '24px'
  rail-inset-wide: '40px'
  block: '48px'
  row: '64px'
  band: '80px'
  section: '96px'
components:
  button-primary:
    backgroundColor: '{colors.action-blue}'
    textColor: '{colors.plate-white}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '0 24px'
    height: '48px'
  button-primary-hover:
    backgroundColor: '{colors.action-blue-deep}'
    textColor: '{colors.plate-white}'
  button-secondary:
    textColor: '{colors.text}'
    typography: '{typography.body}'
    rounded: '{rounded.control}'
    padding: '0 20px'
    height: '48px'
  station-plate:
    backgroundColor: '{colors.action-blue}'
    textColor: '{colors.plate-white}'
    rounded: '{rounded.plate}'
    padding: '2px 8px'
  copy-block:
    backgroundColor: '{colors.monitor-well}'
    textColor: '{colors.text}'
    typography: '{typography.mono}'
    rounded: '{rounded.inset}'
    padding: '12px'
  monitor:
    backgroundColor: '{colors.monitor-well}'
    textColor: '{colors.muted}'
    rounded: '{rounded.monitor}'
  panel:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.text}'
    rounded: '{rounded.panel}'
    padding: '{spacing.panel}'
  nav-link:
    textColor: '{colors.muted}'
    typography: '{typography.label}'
    height: '44px'
  pro-badge:
    backgroundColor: '{colors.line-violet}'
    textColor: '{colors.ground}'
    typography: '{typography.caption}'
    rounded: '{rounded.pill}'
    padding: '4px 12px'
---

# Design System: Orkumo Landing (landing/)

Scope: the static landing page in `landing/` (entry `landing/index.html`, tokens in `landing/styles.css`). The Orkumo app itself (root React app) is not covered; do not apply these tokens there.

## Overview

**Creative North Star: "The Line Control Room"**

The page is a metro operations control room at night, built from the app's own colours. Every project is a line, every agent a train, and the stations are the five jobs: Plan, Steer, Monitor, Review, with Edit as a spur that loops back off Review. The hero is a live line diagram; the five feature rows hang off one continuous blue track rail; product screens sit on the wall as monitors.

The ground is the app's navy, deepened for the page. Blue is the one action colour. The four line colours (emerald, amber, rose, violet) mark lines and states, and the focused station is the brightest thing on screen while the rest dims. Density is calm: one 12-column grid, generous section padding, hairline dividers instead of fills.

Depth is quiet: flat navy surfaces separated by 1px hairlines, with long soft black shadows under monitors and panels only.

**Key Characteristics:**

- Navy ground taken from the app screenshots, with panel, raised and hairline steps of the same hue.
- Straight track with 45-degree or right-angle turns only; no arcs anywhere in a diagram.
- Stations are white ticks with a dark keyline; station name plates are white on action blue.
- State is a mark as well as a hue: hollow ring (needs input), half ring (working), filled dot (done).
- Overpass display, Archivo body, JetBrains Mono only for commands, paths and project names.

## Colors

One navy family for surfaces, one blue for action and track, four line colours reserved for lines and states.

### Primary

- **App Blue** (app-blue): the track. The feature-row rail (at 70%), the storefront line in the hero diagram, the station track of the workflow demo (at 70%), active session dots in the scale table.
- **Action Blue** (action-blue): behind white text only. Primary download button, station name plates, every primary button inside a demo ("GO: Build", "Send feedback to agent"), the illustrated "Buy" chip.
- **Action Blue Deep** (action-blue-deep): hover state of the primary button.
- **Link Blue** (link-blue): links, link hovers, the copy-block `$` prompt, list ticks, icon accents, `acme/<project>` names and PR links in demos, the "pull request open" ring, focus ring, text selection and caret.

### Tertiary (line colours)

- **Line Emerald** (line-emerald): a line in the hero; state "done / ready".
- **Line Amber** (line-amber): a line in the hero; state "working"; the armed (second-click) state of the GO button, mirroring the app's GO.
- **Line Rose** (line-rose): state "needs input"; the halted train at Steer and its ring; the GO station ring and the 60% border of the issue card that waits for your GO.
- **Line Violet** (line-violet): a line in the hero; the Pro mark: badge, Workflow list ticks, the feedback siding of the workflow demo and its "Round n" chip (violet at 15% behind violet text).

### Neutral

- **Control-Room Navy** (ground): page and header background; text on the violet badge.
- **Panel Navy** (panel): panels, demo list rows and issue cards.
- **Raised Navy** (raised): icon wells, copy-button hover, metadata chips in demos (station, mode), illustrated placeholders.
- **Hairline** (hairline): every 1px border, divider, scrollbar thumb, station guide lines in diagrams.
- **Band Navy** (band): full-width bands behind Principles and FAQ.
- **Monitor Well** (monitor-well) and **Pane Well** (pane-well): inside monitors and command wells; panes within the workspace illustration.
- **Keyline** (keyline): the dark outline around station ticks, trains and the rail tick; selection text.
- **Signal White** (text): headlines and primary text; station tick fill. 90% alpha for command text.
- **Muted Blue-Grey** (muted): leads, body copy, nav links, notes, dimmed station labels.
- **Line Label** (line-label): project names beside the hero lines.
- **Plate White** (plate-white): text on action blue; the focused station label; the fill of the selected station disc in the workflow demo.

### Named Rules

**The Line Colours Are Lines Rule.** Emerald, amber, rose and violet colour a line, a train or a state mark, never a panel fill, a heading or a resting button. Carve-outs: violet is also the Pro mark (badge pill, Workflow list ticks, feedback siding, Round chip); rose may outline the one card that waits for you; amber fills the GO button only while it is armed, because the app's GO does the same.

**The One Action Blue Rule.** Every filled control at rest is action blue with white text; no second button colour exists. The armed GO (amber, ground text, for four seconds) is a state, not a second colour.

**The Focus Is Brightest Rule.** In a diagram the focused station or node is full white and full opacity; every other station sits at 60% or in muted.

## Typography

**Display Font:** Overpass Variable (with Archivo Variable, ui-sans-serif)
**Body Font:** Archivo Variable (with ui-sans-serif)
**Mono Font:** JetBrains Mono Variable (with ui-monospace), for commands, paths, URLs, build names and project names only

**Character:** Highway-signage display over a plain, slightly wide grotesk; signs you read at a glance above a control desk.

### Hierarchy

- **Display** (700, clamp(2.6rem, 5.4vw, 4.75rem), 1.02): the hero H1 only, max 15ch.
- **Headline** (700, clamp(1.9rem, 3.6vw, 3rem), 1.06): section headings. The closing headline uses its own step (clamp(2.1rem, 4.4vw, 3.5rem), 1.05).
- **Title** (700, 24px): feature-row and install-panel headings; 20px for the wordmark and the Docker panel; 18px (title-sm) for workspace items and principle terms.
- **Lead** (400, 18px): one paragraph under each section heading, max 65 to 68ch. The hero lead is followed by the claim line "Plan · Orchestrate · Review · Ship" at the same 18px in semibold signal white.
- **Body** (400, 15px, 1.5): panel copy, FAQ, buttons, list points in Workspace, Workflow and Scale; station labels in the hero diagram (15px, 700) in SVG, including "Ship" over the terminal bars.
- **Body Small** (400, 14px): feature-row list points; issue titles in demos.
- **Caption** (13px): pause control, buttons inside demos, workflow station names (600, 12px on phones), the Pro badge (700).
- **Note** (12px): notes under buttons, tables and install panels; the diagram's "Example projects" label.
- **Micro** (11px): the illustrated "Buy" chip (600), the "loop off Review" label, the "feedback" loop label and metadata chips in demos.
- **Label** (600, 0.6875rem, 0.12em, uppercase): label tape on nav links, table headers and monitor title bars.
- **Mono** (400, 13px, 24px line; 12.5px on phones): copy blocks, project names in the hero and scale table. **Mono Small** (12px) inside demos and illustrations (`acme/<project>`, `#n`, station counts in tabular numerals) and for build names and URLs.

### Named Rules

**The Mono Is Evidence Rule.** JetBrains Mono appears only for literal strings a user would type or read off a tool: commands, URLs, paths, build names, project names.

**The Tape Names An Object Rule.** Label tape names a thing on screen (a nav target, a column, a monitor). It never sits above a heading as a section label.

**The One Loud Line Rule.** Rank comes from size alone: one H1 at display scale, everything else visibly smaller.

## Layout

A 12-column grid inside a 1280px container with 20px side gutters, 36px from 640px. Hero, Workspace, Workflow and Scale split text 5 or 6 columns against media 6 or 7 at 1024px, vertically centred on each other; below that everything stacks. Sections carry 96px vertical padding (80px for Principles); headings sit 40 to 48px above their content; grid gaps are 48px, panel gaps 20px, panels 24px inside.

The five feature rows form one column with a 3px app-blue left rail at 70% that runs through all of them; each row is 48px tall-padded (64px at 1024px), inset 24px from the rail (40px from 640px), and alternates text and screen sides. The portrait agents demo takes the narrow column.

**The One Track Rule.** The feature rows share one rail with no gap between rows; each row adds a station tick on it, never a separate card.

## Elevation & Depth

Flat surfaces separated by hairlines. Only monitors, panels and the primary button cast shadows: long, soft, black and pulled upward by negative spread so they read as distance from the wall, not as a lift. Screens on hover scale and tilt in 3D; reduced motion keeps them flat.

### Shadow Vocabulary

- **Monitor rest** (`0 24px 46px -30px rgb(0 0 0 / 0.85)`): every monitor frame.
- **Panel rest** (`0 22px 44px -30px rgb(0 0 0 / 0.85)`): panels.
- **Action shadow** (`0 14px 28px -18px rgb(0 0 0 / 0.95)`): primary button.

**The Soft Black Rule.** Shadows are soft, black and fall downward. No glow, no coloured shadow, no hard offset.

## Shapes

Small corners scaled by object size: 3px for chips, 4px for station plates, copy buttons, demo rows and issue cards, 5px for buttons and illustrated browser frames, 6px for command wells and icon wells, 8px for monitors, 10px for panels. Circles are reserved for state marks, trains (rounded capsules, 7px radius on 14px height), station ticks (round caps), the workflow station discs (30px, 2px ring, count inside) and the Pro badge pill. Borders are 1px hairlines; the rail is 3px.

Track geometry is straight lines with 45-degree or right-angle turns only: the Edit spur drops 20px at 45 degrees; the workflow feedback siding drops from GO, runs back under the track and rises into Brief at right angles, so it survives being stretched to any width.

## Components

### Buttons

- **Shape:** gently squared (5px), 48px minimum height.
- **Primary:** action blue, white 15px bold, 24px horizontal padding, action shadow, download icon. Label adapts to the detected OS. Wrapped in a magnetic hover (strength 0.3, max 16px), off under reduced motion.
- **Hover / Focus:** hover deepens to action blue deep; focus is the global 2px link-blue outline at 3px offset.
- **Secondary:** transparent, hairline border, text 15px semibold, 20px padding; hover moves the border to link blue at 60% and adds a 5% white wash.

### Cards / Containers

- **Monitor:** 8px, hairline, monitor-well fill, monitor shadow, overflow hidden. Holds every demo and illustration. Each carries a title bar with label tape left and "Interactive demo" or "Illustration" right. Demos have a fixed body height (420 to 480px) and scroll inside.
- **Panel:** 10px, hairline, panel fill, panel shadow, 20 to 24px padding. Install options and the scale table.
- **Band:** full-width band-navy strip between hairlines (Principles; FAQ uses the top hairline only).

### Copy Block

Command well (6px, hairline, monitor-well), mono 13px at 90% text, each line prefixed with an unselectable link-blue `$`, a 44px copy button that swaps to a check and announces through a live region.

### Navigation

Sticky 56px header on ground with a bottom hairline. Overpass wordmark left; label-tape links right at 44px hit height, muted to link blue on hover; GitHub in text. Under 768px the links collapse to a single link-blue "Install".

### Line Diagram (signature)

SVG: four project lines in app blue, emerald, violet and amber at 3px, round caps, a terminal bar at the end, labelled "Ship" above. Station columns Plan, Steer, Monitor, Review, each a white tick with a 7px keyline stroke; Edit sits on a 45-degree spur off Review with smaller ticks. Trains are 28 by 14 capsules with a 2px keyline. The rose train halts at Steer under a hollow ring, pulses once and moves on; Steer is full white, other stations at 60%. A pause control sits below; reduced motion shows a static snapshot.

### Feature Row (signature)

A row on the shared blue rail with a white station tick (16 by 22, 3px keyline) at the heading line, a station name plate (action blue, white 15px in the inherited Overpass 700, 4px) before the Overpass title, a muted lead, link-blue tick bullets, and a monitor on the opposite side.

### State Marks

12px SVG circles: rose hollow ring (needs input / waiting for your GO), amber half ring (working), emerald filled dot (done / merged), link-blue hollow ring (pull request open), muted dotted ring (waiting for the poll); always beside a text label.

### Workflow Demo (Pro)

Monitor with a station track on top and issue cards below. Track: six station discs (Queued, Brief, GO, Build, Review, Done) on a 3px app-blue line at 70%; each disc holds its issue count and is a toggle that filters the cards (selected: plate-white fill, ground text). The GO disc carries a rose ring while an issue waits there. The feedback siding runs GO → Brief beneath the track in violet at 45%, full violet after an issue was sent back. Cards: panel fill, hairline (rose at 60% when waiting for you), `acme/<project> #n` in mono, title, state mark with word, raised chips for station and mode, violet Round chip, link-blue PR link; the waiting card carries "GO: Build" (two-step) and "Send back with feedback".

## Do's and Don'ts

### Do:

- **Do** draw every track straight with 45-degree or right-angle turns; stations are white ticks with a dark keyline, or count discs in the workflow demo.
- **Do** put every product screen and illustration in a monitor frame (8px, hairline, monitor well).
- **Do** mark state with shape and hue together, next to a text label.
- **Do** label every HTML/SVG illustration "Illustration" and every demo "Interactive demo" in its title bar.
- **Do** keep a static equivalent for every motion under reduced motion, and a pause control for the looping diagram.
- **Do** keep tap targets at 44px minimum (48px for buttons).

### Don't:

- **Don't** draw arcs or curves in a track or graph.
- **Don't** fill panels, headings or resting buttons with emerald, amber, rose or violet; the violet Pro badge and the armed GO are the only solid line-colour fills.
- **Don't** set prose in mono or headings in anything but Overpass.
- **Don't** put label tape above a heading as an eyebrow.
- **Don't** add glow, coloured shadows or hard offset shadows.

## Product screens

No raster screenshots. The product screens are abstracted, interactive React demos in `landing/demos/` (Board, Agents, Pull requests, Code, Workflow), built from the app's layout with synthetic data only (`DEMO_PROJECTS`, owner `acme`). Each carries a title bar with the mode name left and "Interactive demo" right.

- Interactions are real buttons, inputs and selects; nothing animates on its own; initial state is constant so the prerender hydrates cleanly.
- Terminal, browser and overview stay HTML/SVG illustrations labelled "Illustration".
- A demo action that removes the focused control moves focus to its `role="status"` line; a "Reset demo" control appears once state has changed.
- Two-step confirmations follow the app: first click arms (four seconds), second click acts.
- Never put real repository, owner or session names into a demo.
