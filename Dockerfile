# ── Stage 1: build do frontend (Vite) ──────────────────────────────────────────
FROM node:20-slim AS builder-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: build do backend (TypeScript + node-pty nativo do Linux) ──────────
FROM node:20-slim AS builder-backend
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ── Stage 3: imagem final ───────────────────────────────────────────────────────
FROM node:20-slim
WORKDIR /app

COPY --from=builder-backend /app/backend/dist ./backend/dist
COPY --from=builder-backend /app/backend/node_modules ./backend/node_modules
COPY --from=builder-backend /app/backend/package.json ./backend/package.json
COPY --from=builder-frontend /app/frontend/dist ./frontend/dist

RUN mkdir -p /app/data

EXPOSE 3001
WORKDIR /app/backend
CMD ["node", "dist/server.js"]
