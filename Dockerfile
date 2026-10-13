# ---- deps: production node_modules (better-sqlite3 compiles from source, so this stage needs a toolchain) ----
FROM node:22-bookworm-slim AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ---- build: compile Tailwind CSS (no native modules needed) ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tailwind.config.cjs ./
COPY src ./src
COPY public ./public
COPY admin ./admin
RUN npm run build

# ---- runtime: slim image, no compilers ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
COPY admin ./admin
COPY public ./public
COPY --from=build /app/public/css/app.css ./public/css/app.css
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
