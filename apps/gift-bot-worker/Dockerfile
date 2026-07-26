# syntax=docker/dockerfile:1
# Monorepo-aware Dockerfile — build context must be the repo root.
# docker build -f apps/gift-bot-worker/Dockerfile .
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /voxly

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/twenty-client/package.json packages/twenty-client/
COPY packages/billing/package.json packages/billing/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/analytics-dispatchers/package.json packages/analytics-dispatchers/
COPY packages/crypto/package.json packages/crypto/
COPY apps/gift-bot-worker/package.json apps/gift-bot-worker/

RUN pnpm install --frozen-lockfile
# Prisma schema needed before generating the client
COPY packages/db/prisma/ packages/db/prisma/
RUN pnpm --filter @voxly/db prisma:generate

COPY packages/ packages/
COPY apps/gift-bot-worker/ apps/gift-bot-worker/
RUN pnpm --filter @voxly/gift-bot-worker... build

# --- Runtime ---
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl ffmpeg
WORKDIR /voxly
ENV NODE_ENV=production
COPY --from=builder /voxly ./
EXPOSE 3004
CMD ["node", "apps/gift-bot-worker/dist/index.js"]
