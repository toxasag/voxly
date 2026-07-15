# syntax=docker/dockerfile:1
# Monorepo-aware Dockerfile — build context must be the repo root.
# docker build -f apps/saas-portal/Dockerfile .
FROM node:20-alpine AS builder
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
COPY apps/saas-portal/package.json apps/saas-portal/

RUN pnpm install --frozen-lockfile

COPY packages/ packages/
COPY apps/saas-portal/ apps/saas-portal/

# Next.js needs public env vars at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:3002
ARG NEXT_PUBLIC_VOXLY_DOMAIN=getvoxly.ru
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_VOXLY_DOMAIN=${NEXT_PUBLIC_VOXLY_DOMAIN}
ENV SAAS_API_URL=http://localhost:3002
ENV VOXLY_DOMAIN=${NEXT_PUBLIC_VOXLY_DOMAIN}

RUN pnpm --filter @voxly/saas-portal... build

# --- Runtime ---
FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /voxly
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /voxly ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@voxly/saas-portal", "start"]
