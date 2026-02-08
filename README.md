# CodeReviewer

AI-powered project evaluation system with multi-role perspectives (Boss, Merchant, Operator).

## Features

- **Multi-Role Evaluation**: Analyze projects from Boss (ROI/Risk), Merchant (UX/Pricing), and Operator (Efficiency/Stability) perspectives
- **Multi-Model Support**: Alibaba Qwen, OpenAI GPT-4, Anthropic Claude
- **Code Quality Analysis**: Detect test frameworks, linters, CI/CD, security vulnerabilities
- **Persistent Storage**: JSON file-based storage for evaluation history
- **Report Export**: Markdown and JSON export formats
- **Trend Analysis**: Track project improvement over time
- **Real-time Progress**: WebSocket-based progress updates

## Tech Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js, Express, TypeScript |
| Frontend | React 18, Vite, Ant Design 5 |
| AI Models | Qwen, GPT-4, Claude |
| Charts | ECharts |

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone repository
git clone https://github.com/HenryT2023/code-reviewer.git
cd code-reviewer

# Install dependencies
cd server && npm install
cd ../web && npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys
```

### Running

```bash
# Terminal 1: Start backend
cd server
npm run dev

# Terminal 2: Start frontend
cd web
npm run dev
```

### Access

| Service | URL |
|---------|-----|
| Frontend | http://localhost:9001 |
| Backend API | http://localhost:9000 |
| WebSocket | ws://localhost:9000/ws |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/evaluate` | Start project evaluation |
| GET | `/api/evaluate/:id` | Get evaluation result |
| GET | `/api/history` | List evaluation history |
| GET | `/api/models` | Get available AI models |
| GET | `/api/export/markdown/:id` | Export report as Markdown |
| GET | `/api/export/json/:id` | Export report as JSON |
| GET | `/api/trends/stats` | Get overall statistics |

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
