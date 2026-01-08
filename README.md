# DevOrbit Dashboard

**DevOrbit Dashboard** is an advanced local development environment manager that monitors, controls, and optimizes your development workflow. It integrates with Gemini AI to analyze project configurations and provide intelligent recommendations, making it easier to manage complex microservice architectures and local setups.

## 🚀 Features

- **Project Management**: Monitor and control local applications (Start, Stop, Restart).
- **Intelligent Analysis**: Uses Gemini AI to scan project structures and suggest run configurations.
- **Port Management**: Automatic detection of port conflicts with resolution options (kill process or pick new port).
- **System Monitoring**: Real-time CPU and Memory usage tracking for managed services.
- **Integrated Terminal**: Full-featured web-based terminal emulator for interacting with your services.
- **IDE Integration**: Seamlessly open projects in VS Code, Cursor, WebStorm, and other IDEs.
- **Docker Support**: Manage Docker containers and compose services directly from the dashboard.

## 🛠️ Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS, Lucide Icons, Recharts
- **Backend**: Node.js, Express, WebSocket (ws), node-pty
- **Database**: PostgreSQL (via Drizzle ORM)
- **Caching**: Redis
- **AI**: Google Gemini API

## 📋 Prerequisites

- **Node.js** (v18+ recommended)
- **Docker** & Docker Compose
- **Google Gemini API Key** (for AI features)

## 🏁 Getting Started

### 1. Clone & Install

```bash
git clone <repository-url>
cd devorbit-dashboard
npm install
```

### 2. Environment Setup

Create an `.env.local` file in the root directory:

```bash
GEMINI_API_KEY=your_api_key_here
# Optional: data persistence paths
# SCAN_DIRECTORIES=/Users/username/projects
```

### 3. Run Locally (Full Stack)

To run the entire stack including databases (Postgres, Redis) and the application:

```bash
npm run dev:full
```

This command starts the Docker infrastructure and the development servers for frontend and backend.

### Alternative: Manual Start

If you already have the databases running:

```bash
npm run dev
```

## 🏗️ Architecture

The project follows a monorepo-like structure with a unified backend and frontend:

- **`App.tsx`**: Main frontend entry point and state management.
- **`server/`**: Express backend handling API requests, websocket terminals, and OS interactions.
- **`services/`**: Core logic for AI analysis, port management, and file system scanning.
- **`docker/`**: Infrastructure configuration.

## 🐳 Docker Deployment

You can run the dashboard entirely within Docker:

```bash
docker compose up --build
```

Access the dashboard at `http://localhost:3000`.
