# syntax=docker/dockerfile:1
# Monorepo-aware Dockerfile — build context must be the repo root.
# docker build -f apps/saas-api/Dockerfile .

# --- Private registry tarball for voxly-crm-chat (installApplication on provision) ---
FROM node:24-bookworm-slim AS crm-chat-tarball
ARG VOXLY_CABINET_URL=https://getvoxly.ru/dashboard
WORKDIR /app
RUN corepack enable
COPY twenty-app/voxly-crm-chat/package.json twenty-app/voxly-crm-chat/yarn.lock twenty-app/voxly-crm-chat/.yarnrc.yml ./
COPY twenty-app/voxly-crm-chat/.yarn ./.yarn
COPY twenty-app/voxly-crm-chat/ ./
RUN yarn install && \
    VOXLY_CABINET_URL="${VOXLY_CABINET_URL}" yarn twenty dev:build --tarball && \
    mkdir -p /out && \
    cp .twenty/output/voxly-crm-chat-*.tgz /out/voxly-crm-chat.tgz

FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /voxly

# Copy all workspace manifests first for layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/twenty-client/package.json packages/twenty-client/
COPY packages/billing/package.json packages/billing/
COPY packages/ai-core/package.json packages/ai-core/
COPY packages/analytics-dispatchers/package.json packages/analytics-dispatchers/
COPY packages/crypto/package.json packages/crypto/
COPY apps/saas-api/package.json apps/saas-api/

RUN pnpm install --frozen-lockfile
# Prisma schema needed before generating the client
COPY packages/db/prisma/ packages/db/prisma/
# Generate Prisma client (needed by @voxly/db build + runtime)
RUN pnpm --filter @voxly/db prisma:generate

# Copy source of all packages + the app, then build the app and its workspace deps
COPY packages/ packages/
COPY apps/saas-api/ apps/saas-api/
RUN pnpm --filter @voxly/saas-api... build

# --- Runtime ---
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /voxly
ENV NODE_ENV=production
ENV VOXLY_CRM_CHAT_TARBALL=/voxly/assets/voxly-crm-chat.tgz
COPY --from=builder /voxly ./
COPY --from=crm-chat-tarball /out/voxly-crm-chat.tgz /voxly/assets/voxly-crm-chat.tgz
EXPOSE 3002
CMD ["node", "apps/saas-api/dist/index.js"]
