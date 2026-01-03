# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DevOrbit Dashboard is a React-based developer dashboard that monitores and manages local development applications. It uses Gemini AI to analyze project configurations and provide intelligent recommendations.

It scans the configured directories and subdirectories and analyses inherited projects, on how to run and monitor them specificially. First it reads the docs and the configuration files, like the packaged.json. Only if the given information are ambiguous, it reads the CLAUDE.md or the AGENTS.md file. The info of how to control the applicaions are stored appropriately.

The directories can be configured on the admin panel.

The dashboard shows:
- Total Projects
- Active Services
- Total CPU Load
- AI Analysis
- all used ports
- System alerts
- recommodations (like possible optimizations, updates, etc.)
- per application:
    - name
    - directory
    - technology
    - the status (running, error, cancelled, stopped, starting, analyzing, waiting, etc.)
    - the ports and adresses
    - controls: start, stop, restart, open in browser
- Applications 
    - are grouped by directory and subdirectory
    - can be set as favorites and showed at the top in a separate favorites card
    - can be archived, meaning they are hidden. at the bottom is a panel which opens the archive

The details view for the applicaions show:
- name
- cpu usage
- memory usage
- directory
- technology
- default start command
- the status (running, error, cancelled, stopped, starting, analyzing, waiting, etc.)
- the ports and adresses
- the console output in a web terminal emulator
and provides basic control mechanisms, like:
- start
- stop
- restart
- installing dependencies (like npm install)
- setting a specific port
- open in browser
- AI config

The console output in the details view is a real webbased terminal emulator, supporting multiple tabs. On Default it shows just one tab with the console output. When adding more terminal tabs, each should run the default shell on start.


## Commands

```bash
# Install dependencies
npm install

# Run development server (port 3000)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Environment Setup

Set `GEMINI_API_KEY` in `.env.local` for AI-powered configuration analysis.

## Architecture

This is a single-page React application with a flat file structure (no `src/` directory):

```
├── App.tsx           # Main component with all UI logic and state management
├── index.tsx         # React entry point
├── types.ts          # TypeScript types (AppConfig, AppStatus enum)
├── services/
│   ├── geminiService.ts  # Gemini AI integration for config analysis
│   └── mockOs.ts         # Mock data simulating directory scanning
├── index.html        # HTML shell with Tailwind CDN config
└── vite.config.ts    # Vite config with @/ alias pointing to root
```

### Key Patterns

- **State Management**: All state lives in `App.tsx` using React hooks
- **Styling**: Tailwind CSS via CDN with custom colors (gray-750, gray-850, gray-950)
- **Charts**: Recharts for CPU/memory visualization
- **Icons**: lucide-react
- **AI Integration**: @google/genai SDK with structured JSON responses via `responseSchema`

### AppStatus Flow

Applications transition through states: `STOPPED` -> `STARTING` -> `RUNNING` | `ANALYZING`

### Path Alias

The `@/` alias resolves to the project root (not `src/`), defined in both `tsconfig.json` and `vite.config.ts`.
