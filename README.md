# CodeReviewer

AI-powered project evaluation system with multi-role perspectives. Supports **quick** and **deep** analysis modes for any type of software project — from single-repo apps to large monorepos.

## Features

- **Multi-Role Evaluation**: 4 built-in roles with customizable prompts
  - 👔 **Boss** — ROI, market positioning, risk, scalability
  - 🏪 **Merchant** — UX, feature fit, competitive analysis, value perception
  - ⚙️ **Operator** — Efficiency, reporting, stability, exception handling
  - 🏗️ **Architect** — Code organization, API design, data model, security, DevOps, patterns
- **Quick / Deep Evaluation Modes**
  - *Quick*: Structure + metrics overview (fast, low token cost)
  - *Deep*: Reads actual code samples, Spec docs, cross-service dependencies, architecture patterns → more accurate scoring with evidence-based analysis
- **Enhanced Static Analysis**
  - API endpoint detection (Express, FastAPI, Django, Flask, Next.js, etc.)
  - Database entity & ORM detection (SQLAlchemy, TypeORM, Prisma, Sequelize, etc.)
  - Monorepo / multi-service recognition with per-service breakdown
  - Code quality metrics: complexity, language distribution, largest files, test coverage
  - Python engineering quality (pyproject.toml, Ruff, Black, MyPy, Alembic)
- **Custom Role Prompts**: Override default system prompts per role via `rolePrompts`
- **Real-time Progress**: WebSocket-based status updates during evaluation
- **Persistent Storage**: SQLite-based evaluation history
- **Report Export**: Markdown and JSON export formats
- **Trend Analysis**: Track project improvement over time

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express, TypeScript |
| Frontend | React 18, Vite, Ant Design 5 |
| AI Models | Alibaba Qwen (default), OpenAI GPT-4, Anthropic Claude |
| Charts | ECharts |
| Storage | SQLite (better-sqlite3) |

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/HenryT2023/code-reviewer.git
cd code-reviewer

# Install root dependencies (concurrently)
npm install

# Install server & web dependencies
cd server && npm install
cd ../web && npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Running

```bash
# Option 1: Start both services concurrently
npm run dev

# Option 2: Start separately
# Terminal 1 — Backend
cd server && npm run dev

# Terminal 2 — Frontend
cd web && npm run dev
```

### Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:9001 |
| Backend API | http://localhost:9000 |
| WebSocket | ws://localhost:9000/ws |

## API

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evaluate` | Start project evaluation |
| GET | `/api/evaluate/:id` | Get evaluation result |
| GET | `/api/history` | List evaluation history |
| GET | `/api/models` | Get available AI models |
| GET | `/api/export/markdown/:id` | Export report as Markdown |
| GET | `/api/export/json/:id` | Export report as JSON |
| GET | `/api/trends/stats` | Get overall statistics |

### Evaluate Request Body

```jsonc
{
  "projectPath": "/path/to/project",
  "projectName": "My Project",
  "roles": ["boss", "merchant", "operator", "architect"],
  "context": "Brief project description for AI context",
  "depth": "deep",            // "quick" | "deep"
  "rolePrompts": {            // optional: override default prompts
    "architect": "Custom system prompt for architect role..."
  }
}
```

## Project Structure

```
code-reviewer/
├── server/                  # Backend (Express + TypeScript)
│   └── src/
│       ├── ai/              # AI model integration (Qwen)
│       ├── analyzers/       # Static analysis modules
│       │   ├── api.ts       #   API endpoint detection
│       │   ├── database.ts  #   Database & ORM detection
│       │   ├── metrics.ts   #   Code metrics & complexity
│       │   ├── quality.ts   #   Engineering quality checks
│       │   ├── structure.ts #   Project structure & monorepo detection
│       │   └── index.ts     #   Orchestrator + deep context gathering
│       ├── db/              # SQLite persistence
│       ├── routes/          # Express routes
│       └── ws/              # WebSocket progress events
├── web/                     # Frontend (React + Vite + Ant Design)
│   └── src/
│       ├── pages/           # Evaluate, Report, History, Dashboard
│       └── services/        # API client
├── .env.example
└── package.json             # Root scripts (concurrently)
```

## Environment Variables

```env
# AI Model API Keys (at least one required)
DASHSCOPE_API_KEY=your-qwen-api-key
OPENAI_API_KEY=your-openai-api-key
ANTHROPIC_API_KEY=your-claude-api-key

# Server Port
PORT=9000
```

## License

MIT
