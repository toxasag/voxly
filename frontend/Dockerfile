# GETVOXLY frontend — Next.js 15 Standalone, порт 3000
FROM node:22-alpine AS builder
WORKDIR /app
# NEXT_PUBLIC_* инлайнятся в клиентский бандл на этапе сборки, поэтому
# API-URL пробрасывается build-аргументом, а не только рантайм-переменной.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
RUN mkdir -p public && npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
CMD ["node", "server.js"]
