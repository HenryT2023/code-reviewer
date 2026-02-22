# CodeReviewer

AI-powered project evaluation system with multi-role perspectives. Supports **static**, **dynamic**, and **UI** evaluation modes for any type of software project — from single-repo apps to large monorepos.

## Features

### Multi-Role Evaluation

9 built-in roles with customizable prompts:

| Role | Focus |
|------|-------|
| 👔 **Boss** | ROI, market positioning, risk, scalability |
| 🏪 **Merchant** | UX, feature fit, competitive analysis, value perception |
| ⚙️ **Operator** | Efficiency, reporting, stability, exception handling |
| 🏗️ **Architect** | Code organization, API design, data model, security, DevOps |
| 🎨 **Artist** | Visual design, UX aesthetics, interaction patterns |
| 📈 **Growth** | User acquisition, retention, monetization strategy |
| 💰 **Pricing** | Pricing model, revenue optimization, market fit |
| 📊 **Data** | Data architecture, analytics, metrics design |
| 🔴 **RedTeam** | Security vulnerabilities, attack vectors, risk assessment |

### Evaluation Types

| Type | Description |
|------|-------------|
| **Static** | Code structure, metrics, API/DB detection (default) |
| **Dynamic** | Server startup, health check, API endpoint testing |
| **UI** | Playwright-based UI flow testing with screenshots |
| **Full** | Static + Dynamic + UI combined |

### Evaluation Modes

- **Standard**: Individual role evaluations
- **Launch-Ready**: Multi-role debate + orchestrator synthesis for go/no-go decisions

### Role Self-Evolution

- **Reflection**: AI self-critique after each evaluation, identifying blind spots and prompt improvements
- **Synthesis**: Aggregate reflections to generate new roles and improve existing prompts
- **Rerun API**: Backfill reflections for historical evaluations

### Static Analysis

- API endpoint detection (Express, FastAPI, Django, Flask, Next.js, etc.)
- Database entity & ORM detection (SQLAlchemy, TypeORM, Prisma, Sequelize, etc.)
- Monorepo / multi-service recognition with per-service breakdown
- Code quality metrics: complexity, language distribution, largest files, test coverage
- Python engineering quality (pyproject.toml, Ruff, Black, MyPy, Alembic)

### Other Features

- **Custom Role Prompts**: Override default system prompts per role
- **Real-time Progress**: WebSocket-based status updates
- **Persistent Storage**: JSON-based evaluation history
- **Report Export**: Markdown and JSON export formats
- **Trend Analysis**: Track project improvement over time

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express, TypeScript |
| Frontend | React 18, Vite, Ant Design 5 |
| AI Models | DeepSeek V3 (default), Alibaba Qwen, OpenAI GPT-4 |
| UI Testing | Playwright |
| Charts | ECharts |
| Storage | JSON file-based persistence |

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

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evaluate` | Start project evaluation |
| GET | `/api/evaluate/:id` | Get evaluation result |
| GET | `/api/history` | List evaluation history |
| GET | `/api/health` | Health check |

### Evolution Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/evolution/reflections` | List all reflections |
| GET | `/api/evolution/reflections/:id` | Get reflection for evaluation |
| POST | `/api/evolution/rerun-reflection/:id` | Rerun reflection for completed evaluation |
| POST | `/api/evolution/synthesize` | Trigger evolution synthesis |
| GET | `/api/evolution/stats` | Get evolution statistics |

### Export Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/export/markdown/:id` | Export report as Markdown |
| GET | `/api/export/json/:id` | Export report as JSON |
| GET | `/api/trends/stats` | Get overall statistics |

### Evaluate Request Body

```jsonc
{
  "projectPath": "/path/to/project",
  "projectName": "My Project",
  "roles": ["boss", "merchant", "operator", "architect", "artist"],
  "context": "Brief project description for AI context",
  "depth": "deep",                    // "quick" | "deep"
  "mode": "launch-ready",             // "standard" | "launch-ready"
  "evaluationType": "full",           // "static" | "dynamic" | "ui" | "full"
  "rolePrompts": {                    // optional: override default prompts
    "architect": "Custom system prompt for architect role..."
  }
}
```

## Project Structure

```
code-reviewer/
├── server/                  # Backend (Express + TypeScript)
│   └── src/
│       ├── ai/              # AI model integration
│       │   ├── qwen.ts      #   DeepSeek/Qwen API client
│       │   ├── roles.ts     #   Role definitions & prompts
│       │   ├── orchestrator.ts  # Debate & orchestrator synthesis
│       │   └── role-evolution.ts # Reflection & evolution synthesis
│       ├── analyzers/       # Static analysis modules
│       │   ├── api.ts       #   API endpoint detection
│       │   ├── database.ts  #   Database & ORM detection
│       │   ├── metrics.ts   #   Code metrics & complexity
│       │   ├── quality.ts   #   Engineering quality checks
│       │   └── structure.ts #   Project structure & monorepo
│       ├── eval/            # Dynamic & UI evaluation
│       │   ├── runtime.ts   #   Server startup & API testing
│       │   ├── ui.ts        #   Playwright UI flow testing
│       │   └── types.ts     #   Evaluation type definitions
│       ├── db/              # JSON file persistence
│       ├── routes/          # Express routes
│       │   ├── evaluate.ts  #   Evaluation API
│       │   └── evolution.ts #   Evolution API
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
DEEPSEEK_API_KEY=your-deepseek-api-key    # Recommended (default)
DASHSCOPE_API_KEY=your-qwen-api-key
OPENAI_API_KEY=your-openai-api-key

# Server Port
PORT=9000
```

## License

MIT
