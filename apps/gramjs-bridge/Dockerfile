# syntax=docker/dockerfile:1
# Monorepo-aware Dockerfile — build context must be the repo root.
# docker build -f apps/gramjs-bridge/Dockerfile .
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /voxly

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/crypto/package.json packages/crypto/
COPY apps/gramjs-bridge/package.json apps/gramjs-bridge/

RUN pnpm install --frozen-lockfile
COPY packages/db/prisma/ packages/db/prisma/
RUN pnpm --filter @voxly/db prisma:generate

COPY packages/ packages/
COPY apps/gramjs-bridge/ apps/gramjs-bridge/
RUN pnpm --filter @voxly/gramjs-bridge... build

FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /voxly
ENV NODE_ENV=production
COPY --from=builder /voxly ./
EXPOSE 3008
CMD ["node", "apps/gramjs-bridge/dist/index.js"]
