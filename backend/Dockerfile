# GETVOXLY backend — Fastify 5 (TS, ESM), порт 4000
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Корневые сертификаты Минцифры («Russian Trusted Root CA»).
#
# Обязательны для канала MAX: platform-api2.max.ru предъявляет сертификат,
# выпущенный этим УЦ, которого нет в стандартном наборе ca-certificates. Без
# него любой вызов Bot API падает с `fetch failed` (ошибка TLS-валидации), и
# регистрация webhook при старте не проходит — MAX-бот молча не работает.
# Проверено на живой цепочке: с этим корнем `openssl s_client` даёт
# `Verify return code: 0 (ok)`.
#
# Сертификаты лежат в репозитории, а не скачиваются на сборке: загрузка с
# внешнего URL сделала бы сборку зависимой от доступности gu-st.ru и подменяемой.
# SHA-256 корня: D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:
#                5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31
COPY certs/russian_trusted_root_ca_pem.crt certs/russian_trusted_sub_ca_pem.crt \
     /usr/local/share/ca-certificates/
RUN apk add --no-cache ca-certificates && update-ca-certificates

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist

# Миграции (M6.2.7). Копируются в рантайм-образ, а не только в builder: прогон
# выполняется entrypoint'ом при старте контейнера, поэтому и SQL-файлы, и конфиг
# раннера должны быть внутри финального образа.
#
# `node-pg-migrate` объявлен в `dependencies`, а не в `devDependencies`, именно
# по этой причине — `npm ci --omit=dev` выше иначе его бы не установил.
COPY migrate-config.cjs ./
COPY scripts ./scripts
COPY src/db/migrations ./src/db/migrations

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000

# Миграции применяются до старта Node: см. комментарий в docker-entrypoint.sh о
# том, почему это не делается внутри server.ts (приложение работает под ролью
# без прав на DDL).
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
