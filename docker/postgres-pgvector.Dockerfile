# =============================================================================
# PostgreSQL 16 + pgvector 0.8.0 (Alpine)
#
# Почему сборка из исходников, а не готовый образ: pgvector публикует только
# Debian-теги (`0.8.0-pg16`, `-bookworm`, `-trixie`) — alpine-варианта нет вовсе
# (проверено в Docker Hub, 32 тега, ни одного с `alpine`).
#
# Переход на Debian-образ означал бы смену libc с musl на glibc, то есть смену
# библиотеки сортировки строк. Существующий том `getvoxly_pg_data` создан под
# musl, и после такой замены порядок сортировки текста изменился бы: 66
# существующих индексов, включая UNIQUE по `lower(email)`, `slug` и телефону,
# стали бы неконсистентными с данными. Практически это выглядит как
# «пользователь есть в таблице, но не находится по e-mail» и как возможность
# вставить дубль в обход UNIQUE — до полного `REINDEX DATABASE`, который на живой
# базе требует эксклюзивных блокировок. Компиляция расширения дешевле и
# полностью сохраняет окружение.
#
# Версия закреплена тегом: `master` в сборочном образе означал бы, что состав
# расширения меняется между пересборками без изменения кода.
# =============================================================================

ARG POSTGRES_VERSION=16-alpine
ARG PGVECTOR_VERSION=v0.8.0

FROM postgres:${POSTGRES_VERSION} AS builder

ARG PGVECTOR_VERSION

# `postgresql16-dev` даёт pg_config и заголовки сервера, без которых PGXS не
# соберёт расширение. Всё это остаётся в builder-слое и в финальный образ не
# попадает.
RUN apk add --no-cache build-base git postgresql16-dev

# Флаги сборки, каждый по своей причине:
#
# `with_llvm=no` — образ PostgreSQL собран с `--with-llvm`
# (`LLVM_CONFIG=/usr/lib/llvm21/bin/llvm-config`, проверено через
# `pg_config --configure`), поэтому PGXS по умолчанию требует clang/llvm той же
# мажорной версии для сборки bitcode под JIT-инлайнинг. Проверено при сборке:
# пакета `llvm19` в Alpine 3.24 нет вовсе, а установка полного `llvm21` (≈1 ГБ)
# падает при распаковке. Bitcode здесь и не нужен: он даёт JIT-инлайнинг функций
# расширения в запросах, а векторный поиск ограничен обходом HNSW-индекса, не
# интерпретацией выражений. Проверено на живом контейнере: `CREATE EXTENSION`,
# HNSW-индекс по `vector(1536)` и оператор `<=>` работают.
#
# `OPTFLAGS=""` — на musl сборка с `-march=native` падает на части хостов, а
# выигрыш в скорости несопоставим с риском получить образ, не запускающийся на
# другом процессоре.
RUN git clone --branch "${PGVECTOR_VERSION}" --depth 1 \
      https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && cd /tmp/pgvector \
 && make OPTFLAGS="" with_llvm=no \
 && make install with_llvm=no

FROM postgres:${POSTGRES_VERSION}

# Только артефакты расширения: библиотека, SQL-скрипты версий и control-файл.
# Компилятор в рантайме не нужен и увеличивал бы поверхность атаки.
COPY --from=builder /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=builder /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/

# Проверка на этапе сборки: без неё отсутствие файлов обнаружилось бы только при
# `CREATE EXTENSION` в миграции, то есть на старте контейнера.
RUN test -f /usr/local/lib/postgresql/vector.so \
 && test -f /usr/local/share/postgresql/extension/vector.control
