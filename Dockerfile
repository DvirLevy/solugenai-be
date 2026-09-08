# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
# Compiles TypeScript and generates the Prisma client. Nothing from this stage
# reaches the final image except dist/, so the compiler and test tooling stay out.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY prisma ./prisma
COPY src ./src

RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only. The Prisma CLI is a runtime dependency rather than a
# dev one because the container applies migrations on start.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The generated client is platform-specific, so it is generated here rather than
# copied out of the build stage.
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=build /app/dist ./dist
# Served by GET /api/docs, and resolved relative to dist/routes at runtime.
COPY openapi.yaml ./

USER node

EXPOSE 4000

# Migrations run before the server accepts traffic, so a fresh database is usable
# immediately after `docker compose up`.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
