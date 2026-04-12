# CodeReviewer server — multi-stage build.
#
# Stage 1: install deps + build TypeScript → dist/
# Stage 2: copy only dist/ + node_modules (production) → slim runtime image
#
# Usage:
#   docker build -t code-reviewer .
#   docker run -d --name code-reviewer -p 9000:9000 --env-file .env code-reviewer

FROM node:20-alpine AS builder

WORKDIR /app/server

# Copy package files first for layer caching
COPY server/package.json server/package-lock.json ./
RUN npm ci

# Copy source and build
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ─── Runtime stage ────────────────────────────────────────────────────

FROM node:20-alpine

WORKDIR /app/server

# Only production deps
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output
COPY --from=builder /app/server/dist ./dist

# Data directory for JSON persistence + traces
RUN mkdir -p /app/server/data/traces

EXPOSE 9000

ENV NODE_ENV=production
ENV PORT=9000

CMD ["node", "dist/index.js"]
