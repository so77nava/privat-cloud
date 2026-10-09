# ---------- Frontend bauen ----------
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Backend-Abhängigkeiten (better-sqlite3 ist ein natives Modul) ----------
FROM node:22-bookworm-slim AS backend-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev

# ---------- Laufzeit-Image ----------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/public
WORKDIR /app/backend
COPY --from=backend-deps /app/backend/node_modules ./node_modules
COPY backend/package.json ./
COPY backend/src ./src
COPY --from=frontend /app/frontend/dist /app/public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
