# Multi-stage build for claude-code-limiter server
# Runs the Express server with SQLite, serves dashboard on same port

# Stage 1: Install server dependencies
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev

# Stage 2: Production image
FROM node:20-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY bin/ ./bin/

# Dashboard (vanilla JS — no build step needed)
RUN mkdir -p ./dashboard/dist
COPY src/dashboard/ ./dashboard/dist/

RUN mkdir -p /data
RUN groupadd --system limiter && \
    useradd --system --gid limiter --home /app limiter && \
    chown -R limiter:limiter /app /data
ENV NODE_ENV=production
ENV DATA_DIR=/data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
USER limiter
CMD ["node", "bin/server.js"]
