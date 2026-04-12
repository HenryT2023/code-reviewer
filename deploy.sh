#!/usr/bin/env bash
# CodeReviewer deploy script for Alibaba Cloud ECS (Baota panel).
#
# Run this ON THE ECS via Baota terminal or SSH:
#
#   curl -fsSL https://raw.githubusercontent.com/HenryT2023/code-reviewer/main/deploy.sh | bash
#
# Or clone first and run locally:
#
#   git clone https://github.com/HenryT2023/code-reviewer.git
#   cd code-reviewer && bash deploy.sh
#
# Prerequisites: Node.js 18+ and npm. Baota typically has Node.js available
# via its App Store — install "Node.js version manager" if you haven't.
#
# After deploy, you MUST create /opt/code-reviewer/.env with your API keys.
# See the .env.example at the end of this script's output.

set -euo pipefail

APP_DIR="/opt/code-reviewer"
REPO_URL="https://github.com/HenryT2023/code-reviewer.git"
BRANCH="main"

echo "╔══════════════════════════════════════════╗"
echo "║   CodeReviewer Deploy — Alibaba ECS SG   ║"
echo "╚══════════════════════════════════════════╝"
echo

# ─── 1. Check Node.js ────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install Node.js 18+ first:"
  echo "   - Baota panel: App Store → Node.js version manager → install 20.x"
  echo "   - Or: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt install -y nodejs"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "❌ Node.js $NODE_VER detected, need 18+. Please upgrade."
  exit 1
fi
echo "✅ Node.js $(node -v)"

# ─── 2. Clone or update repo ─────────────────────────────────────────

if [ -d "$APP_DIR/.git" ]; then
  echo "📦 Updating existing repo at $APP_DIR..."
  cd "$APP_DIR"
  git fetch origin
  git reset --hard "origin/$BRANCH"
else
  echo "📦 Cloning repo to $APP_DIR..."
  sudo mkdir -p "$APP_DIR"
  sudo chown "$(whoami)" "$APP_DIR"
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
echo "✅ Code synced to $(git log --oneline -1)"

# ─── 3. Install deps + build ─────────────────────────────────────────

echo "📦 Installing server dependencies..."
cd "$APP_DIR/server"
npm ci --omit=dev 2>&1 | tail -3

# We need devDependencies for the build step (typescript, tsx)
echo "📦 Installing build tools..."
npm install --save-dev typescript tsx 2>&1 | tail -3

echo "🔨 Building TypeScript..."
npx tsc
echo "✅ Build complete: dist/"

# Clean up dev deps after build to save space
npm prune --omit=dev 2>&1 | tail -3

# Ensure data directories exist
mkdir -p "$APP_DIR/server/data/traces"

# ─── 4. Set up .env ──────────────────────────────────────────────────

ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo
  echo "⚠️  No .env file found. Creating a template at $ENV_FILE"
  echo "   You MUST edit it and fill in your API keys before starting."
  cat > "$ENV_FILE" <<'ENVEOF'
# At least one LLM provider key is required.
DEEPSEEK_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

PORT=9000
ENVEOF
  echo "   → Edit: nano $ENV_FILE"
fi

# ─── 5. Set up pm2 ───────────────────────────────────────────────────

if ! command -v pm2 &>/dev/null; then
  echo "📦 Installing pm2..."
  npm install -g pm2
fi

# Stop old instance if running
pm2 delete code-reviewer 2>/dev/null || true

echo "🚀 Starting CodeReviewer via pm2..."
cd "$APP_DIR/server"
pm2 start dist/index.js \
  --name code-reviewer \
  --env "$(cat "$ENV_FILE" | grep -v '^#' | grep '=' | tr '\n' ',')" \
  --max-memory-restart 1G

pm2 save

echo
echo "╔══════════════════════════════════════════╗"
echo "║              Deploy Complete             ║"
echo "╚══════════════════════════════════════════╝"
echo
echo "  Server:    http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'YOUR_IP'):9000"
echo "  Health:    curl http://localhost:9000/api/health"
echo "  Logs:      pm2 logs code-reviewer"
echo "  Status:    pm2 status"
echo
echo "  ⚠️  记得编辑 $ENV_FILE 填入 API keys！"
echo "  然后重启: pm2 restart code-reviewer"
echo
