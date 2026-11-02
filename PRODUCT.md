# Product

<!-- impeccable:product-schema 1 -->

<!-- Source: docs/VISION.md, README.md and Hape's answers on issue #37 (2026-10-29). Facts marked (inferred) were not confirmed in an init interview; the run was unattended on the mw board. -->

## Platform

web

## Users

Primary: developers who run several coding agents (Claude Code) in parallel across repos and machines and lose track of which agent works on which issue, branch and PR. They meet DevOrbit through the public GitHub repo `hpmartini/DevHub` and its landing page. (inferred from the public repo; confirmed: the page targets public visitors)

Owner and first user: Hape, who uses DevOrbit as his complete daily work environment.

## Product Purpose

DevOrbit is an ADE (Agentic Development Environment): plan issues, steer agents, edit code and use terminals across all devices without leaving the app. Success: a visitor understands the context idea in seconds and starts DevOrbit locally from the repo.

## Positioning

Features are modes of one environment connected by the **context**: Issue ↔ Agent(s) ↔ Worktree/Branch ↔ Pull Request ↔ Code. Links are derived, not maintained by hand (mw-board comment with session id, PR links in `~/.claude/jobs/<id>/state.json`, "Closes #n", the session's worktree). Uses only the unmodified `claude` CLI.

## Operating Context

- Modes in one shell: Overview, Board (GitHub Projects mirror, drag & drop sets status), Agents (`/agents`, browser version of `claude agents`: dispatch, peek, attach in tabs or tiles), Code (VS Code server / web IDE), Terminal (web terminal with tabs incl. Claude Code tabs).
- Mesh: all devices joined over an existing Tailscale tailnet. Agents keep running on their own machine; remote is view/steer or SSH attach. No session migration.
- Runs locally: Bun, React 19, Express, node-pty, optional Electron desktop app; iOS client in progress (issue #120).

## Capabilities and Constraints

- Start locally: `bun install`, `bun run dev:full` (needs Docker for Postgres/Redis).
- Undecided: license messaging, pricing (none), hosted version (none). Do not claim any.

## Brand Commitments

- Name: DevOrbit. Repo name DevHub appears only in links.
- Landing page language: English.
- Brief-pinned (issue #37): dark atmosphere instead of flat colour, asymmetric bento grid, staggered reveals, magnetic or tilt hover, distinctive type instead of Inter/Roboto/system fonts, no generic "AI slop".
- Logo: `public/logo.png`, `public/favicon.svg`.

## Evidence on Hand

- Real screenshots: `docs/screenshots/` (agents, board, issue modal, mesh remote agents, workflows). Check each for private data before publishing.
- No testimonials, users, benchmarks or stars to cite. Do not fabricate any.

## Product Principles

1. Context before feature.
2. One click between modes, the context stays.
3. One shell.
4. Only the unmodified `claude` CLI.
