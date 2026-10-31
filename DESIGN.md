---
name: DevOrbit Landing (landing/)
description: Design system of the public landing page in landing/ only; the root React app is not covered.
colors:
  signal-yellow: '#f5c518'
  andon-red: '#ff3b30'
  andon-amber: '#ffb020'
  andon-green: '#3ddc84'
  ground: '#0b0f14'
  panel: '#141b24'
  panel-2: '#1b2330'
  slot: '#0d1218'
  hairline: '#242d3a'
  paper: '#f2f0ea'
  muted: '#a3acb9'
  label-ink: '#cfd6e0'
  command-well: '#080b0f'
  shot-well: '#070a0e'
typography:
  display:
    fontFamily: 'Big Shoulders Display Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: 'clamp(3rem, 7vw, 6rem)'
    fontWeight: 800
    lineHeight: 0.9
    letterSpacing: '0.005em'
  headline:
    fontFamily: 'Big Shoulders Display Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: 'clamp(2rem, 4.5vw, 3.5rem)'
    fontWeight: 800
    lineHeight: 1
    letterSpacing: '0.005em'
  title:
    fontFamily: 'Big Shoulders Display Variable, Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '1.5rem'
    fontWeight: 800
    lineHeight: 1.25
    letterSpacing: '0.005em'
  body:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '15px'
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'Archivo Variable, ui-sans-serif, sans-serif'
    fontSize: '0.6875rem'
    fontWeight: 650
    letterSpacing: '0.1em'
  mono:
    fontFamily: 'JetBrains Mono Variable, ui-monospace, monospace'
    fontSize: '13px'
    fontWeight: 400
    lineHeight: 1.85
rounded:
  ink: '3px'
  control: '5px'
  inset: '6px'
  frame: '8px'
  board: '10px'
spacing:
  gutter: '20px'
  gutter-wide: '36px'
  panel: '24px'
  block: '48px'
  section: '96px'
components:
  button-primary:
    backgroundColor: '{colors.signal-yellow}'
    textColor: '{colors.ground}'
    rounded: '{rounded.control}'
    padding: '0 24px'
    height: '48px'
  button-primary-hover:
    backgroundColor: '#ffd43b'
    textColor: '{colors.ground}'
  button-ghost:
    textColor: '{colors.paper}'
    rounded: '{rounded.control}'
    padding: '0 20px'
    height: '48px'
  tcard:
    backgroundColor: '{colors.signal-yellow}'
    textColor: '{colors.ground}'
    rounded: '{rounded.ink}'
    padding: '8px 9px'
  panel:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.paper}'
    rounded: '{rounded.board}'
    padding: '{spacing.panel}'
  copy-block:
    backgroundColor: '{colors.command-well}'
    textColor: '{colors.paper}'
    rounded: '{rounded.inset}'
    typography: '{typography.mono}'
    padding: '12px'
  nav-link:
    textColor: '{colors.paper}'
    typography: '{typography.label}'
    height: '44px'
---

# Design System: DevOrbit Landing (landing/)

Scope: this file covers the static landing page in `landing/` (entry `landing/index.html`, styles `landing/styles.css`) and nothing else. The DevOrbit app itself (root React app) has no recorded design system; do not apply these tokens there.

## Overview

**Creative North Star: "The Night-Shift Planning Wall"**

The page is a factory planning wall after hours: blue-black powder-coated steel, a faint horizontal brushed grain over everything, hairline rails dividing the wall into slots, and one card-stock T-card in signal yellow that travels those slots. The board is the page's object, not a decoration: the hero shows it, the "How it works" section drives the same card through five slots on scroll, and the static fallback repeats the five slots as a compact row.

Density is calm and strict. Repeated identical units (five slots, mode panels, build rows) are the ruler; panels share one surface treatment, one radius and one hairline. Colour is almost absent: steel neutrals, paper text, one yellow for the card and every interactive accent, and three andon lamp colours that mean status and nothing else.

Depth comes from the physical metaphor: slots are recessed, cards and panels sit on soft, downward offset shadows, nothing emits light.

**Key Characteristics:**

- Blue-black steel ground with a fixed fractal-noise grain at 5.5% opacity and one top-right radial lift.
- One yellow T-card with black keyline ink as the sole saturated surface.
- Andon lamps (red, amber, green) used only as task status.
- Condensed heavy uppercase display, plain Archivo body, mono only for commands, paths and IDs.
- Hairline borders and recessed slots instead of fills to separate regions.

## Colors

Steel neutrals and paper text carry the page; signal yellow is the single accent; andon colours are reserved status lamps.

### Primary

- **Signal Yellow** (signal-yellow): the T-card stock, the primary download button, list markers, the copy-prompt `$`, the active step on the slot rail (border at 70%, fill at 12%), text selection, caret and the focus ring. Every interactive accent is this one yellow.

### Tertiary (status only)

- **Andon Red** (andon-red): lamp state "needs input"; the only lamp that blinks.
- **Andon Amber** (andon-amber): lamp state "working".
- **Andon Green** (andon-green): lamp state "ready for review".

### Neutral

- **Powder-Coat Ground** (ground): page background, header at 85% with backdrop blur, ink on yellow (button text, card keyline and card text).
- **Panel Steel** (panel) to **Panel Steel Light** (panel-2): the vertical gradient of every panel, bottom to top.
- **Recessed Slot** (slot): board slots, trail slots, inset machine rows and the full-width bands behind Principles and FAQ.
- **Hairline Rail** (hairline): every 1px border, divider and slot rail.
- **Paper** (paper): headlines and primary text. Softer tones are paper at 85% and 90% alpha, used for claims and code lines.
- **Muted Steel** (muted): secondary text — leads, list points, nav links. At least 7:1 on ground and panel.
- **Label Ink** (label-ink): slot labels on the board and trail.
- **Command Well** (command-well): background of copyable command blocks and the mesh command line.
- **Screenshot Well** (shot-well): frame behind product screenshots.

The card stock is yellow only; the salmon, mint and sky tokens from the direction were dropped because nothing used them.

### Named Rules

**The One Card Colour Rule.** Signal yellow is the only saturated fill on the page. It marks the task card and the action; nothing else may be filled with it.

**The Andon Means Status Rule.** Red, amber and green appear only as lamp states on a card, each paired with screen-reader text. Never as decoration, headings or buttons.

## Typography

**Display Font:** Big Shoulders Display Variable (with Archivo Variable, ui-sans-serif)
**Body Font:** Archivo Variable (with ui-sans-serif)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace), for commands, paths, branch names and issue IDs only

**Character:** A condensed, heavy industrial face shouted in caps against a sober grotesk body; the pairing reads like stencilled column headers over a typed work order.

### Hierarchy

- **Display** (800, clamp(3rem, 7vw, 6rem), 0.9, uppercase): the hero headline only.
- **Headline** (800, clamp(2rem, 4.5vw, 3.5rem), 1, uppercase): section headings. Two in-between display steps exist: the closing headline (clamp(2.25rem, 5vw, 4rem), 1) and the walk's step claim (clamp(1.6rem, 2.6vw, 2.35rem), 1.05).
- **Title** (800, 1.5rem, tight, uppercase): panel and mode headings; 1.125rem for principle terms and the wordmark at 1.25rem.
- **Body** (400, 15px, 1.5): panel copy, FAQ answers, step text. Leads run at 1.125rem with max-width 36rem; mode bullet lists at 14px; notes at 0.75rem.
- **Label** (650, 0.6875rem, 0.1em, uppercase): "label tape" on nav links, board rail, slot headers and the slot-rail buttons. Narrows to 0.625rem / 0.06em under 640px so five labels fit a phone.
- **Mono** (400, 12.5px to 13px, line height 24px): command blocks. Card IDs at 0.6875rem / 700; branch meta at 0.625rem, 72% opacity.

### Named Rules

**The Tape Not Kicker Rule.** Label tape names a physical thing (a slot, a board, a nav target). It never sits above a heading as a section label.

**The Mono Is Evidence Rule.** JetBrains Mono appears only for literal strings a user would type or read off a tool: commands, URLs, branches, issue numbers, machine names.

## Layout

A 12-column grid inside a 1280px container (max-w-7xl) with 20px side gutters, 36px from 640px. The hero and Mesh split 6/6 and 5/7 at 1024px; Modes is an asymmetric bento (Agents 5 columns spanning two rows, Board and Code 7, the two text-only modes 6/6, Usage full width). Sections are separated by 96px vertical padding (80px for Principles), headings sit 48px above their grid, panels are 20 to 24px inside with a 20px grid gap.

The board is five equal columns, 208px tall with 32px label rows. Under 768px it rotates: five stacked rows, 84px label column, 460px tall, and the card walks vertically. The scroll walk lives in a 500vh wrapper with a sticky viewport (board 7 columns, step text and screenshot 5); below desktop and under reduced motion it is replaced by a static list where each step carries its own trail row.

**The Fixed Ruler Rule.** Slot counts and slot widths never change between views: always five, always equal. The card moves by exactly one slot width per step.

## Elevation & Depth

A recessed-and-resting system. Slots are sunk (darker fill, faint 26px ruled lines), panels and the board carry a 4% white top inner highlight plus a long, soft drop shadow pulled upward by negative spread, and cards sit with a short contact shadow plus a long soft one. Ghosted cards lose their shadow. At rest there is no glow or coloured shadow anywhere.

### Shadow Vocabulary

- **Board / Panel rest** (`inset 0 1px 0 rgb(255 255 255 / 0.04), 0 22px 48px -30px rgb(0 0 0 / 0.85)`; board uses `0 26px 60px -36px rgb(0 0 0 / 0.9)`): every large surface.
- **Card in slot** (`0 3px 6px -2px rgb(0 0 0 / 0.55), 0 12px 22px -14px rgb(0 0 0 / 0.95)`): the T-card. The trail card uses the long half only.
- **Action lift** (`0 6px 14px -6px rgb(0 0 0 / 0.8)`): primary button.

**The Soft Offset Rule.** Shadows are soft, black and fall downward. No hard offset shadows, no coloured shadows.

## Shapes

Small, square-shouldered corners scaled by object size: 3px for card ink, 4 to 5px for controls, 6px for insets and command wells, 8px for screenshot frames, 10px for the board and panels. Andon lamps are the only circles (8px). Borders are 1px hairlines everywhere except the 2px black keyline around T-cards. Empty future slots on the trail are drawn with a 1px dashed hairline.

## Components

### Buttons

- **Shape:** gently squared (5px), 48px minimum height.
- **Primary:** signal yellow fill, ground text, 15px bold, 24px horizontal padding, 1px black/70 border, action-lift shadow. Label adapts to the detected OS ("Download for macOS"). Wrapped in a magnetic hover (strength 0.3, max 16px), disabled under reduced motion.
- **Hover / Focus:** hover brightens to a lighter yellow; focus is the global 2px yellow outline at 3px offset.
- **Ghost:** transparent, hairline border, paper 15px semibold, 20px padding; hover lifts the border to paper/50 and adds a 5% white wash.

### Cards / Containers

- **Panel:** 10px radius, hairline border, panel-2 to panel vertical gradient, rest shadow, 20 to 24px padding. The single container for modes, steps, install and mesh.
- **Inset:** recessed slot fill, hairline, 6px; rows inside a panel.
- **Band:** full-width strip in slot colour between hairlines, used to set Principles and FAQ apart.

### T-Card (signature)

Yellow card stock, 2px ground keyline, 3px radius, mono ID top left, three-lamp andon stack top right, 13px bold title, mono branch meta pinned to the bottom (hidden on phones). Ghost state: desaturated slate fill, 55% opacity, no shadow; it marks the slot the card just left.

### Planning Board (signature)

A hairline-ruled frame with a label-tape rail ("Planning board" / "Example"), five labelled recessed slots and an absolute card layer whose position is a CSS variable in slot units, so the scroll walk moves the card without re-rendering. Below it in the walk sits the slot rail: five label-tape buttons, active one in yellow with an arrow. Slot names sit on black tape strips (1px top highlight, soft offset shadow); the active slot of a static board is on red tape.

### Copy Block

Command well, hairline, 6px; each line prefixed with an unselectable yellow `$`; a 44px icon button swaps copy for check and announces the change through a live region.

### Navigation

Sticky 56px header in ground at 85% with backdrop blur and a bottom hairline. Wordmark in display face left, label-tape links right at 44px hit height, paper on hover; GitHub link with icon; on phones the links collapse to a single yellow "Install".

### Screenshot Frame

Screenshot well, hairline, 6 to 8px radius. In Modes the image tilts on hover (3 degrees, 4px translate, spring); reduced motion shows it flat. The library glare layer is removed (no-glow system).

## Do's and Don'ts

### Do:

- **Do** keep every panel on the same surface: 10px radius, hairline border, panel gradient, rest shadow.
- **Do** use signal yellow for the card and for every interactive accent, and nothing else.
- **Do** pair each andon lamp with screen-reader status text.
- **Do** keep five equal slots in every board view and move the card by exactly one slot per step.
- **Do** keep a static, ghosted equivalent for every scroll or hover motion under reduced motion.
- **Do** keep tap targets at 44px minimum (48px for buttons).

### Don't:

- **Don't** use andon red, amber or green outside lamp states.
- **Don't** put label tape above headings as an eyebrow; it labels objects.
- **Don't** add glow, coloured shadows or hard offset shadows; depth is soft and black.
- **Don't** set display text in anything but the condensed display face, or commands in anything but mono.
- **Don't** fill large regions with yellow beyond the card and the primary button.

## Raster provenance

Five product screenshots in `landing/img/`, all added in commit c0e2777 (2026-10-31):

| File            | Size      | Rendered                  |
| :-------------- | :-------- | :------------------------ |
| `agents.webp`   | 440×910   | yes (Modes, How it works) |
| `board.webp`    | 1400×1114 | yes (Modes, How it works) |
| `code.webp`     | 825×900   | yes (Modes, How it works) |
| `overview.webp` | 1160×545  | no                        |
| `terminal.webp` | 1150×800  | no                        |

- Privacy-checked by hand before commit: no private paths, tokens or customer names.
- `code.webp` and `overview.webp` show the demo workspace `/Users/Shared/demo`; `board.webp` and `agents.webp` show the public `hpmartini/DevHub` repo and the public MACC board.
- `overview.webp` shows pre-#143 features and `terminal.webp` shows test input; neither is imported nor in the build. Both need a fresh capture before reuse.
- Any new raster gets the same hand check and a row here before it ships.
