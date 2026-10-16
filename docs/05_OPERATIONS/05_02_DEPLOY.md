# 05_02 — Деплой по SSH-ключу

> **Назначение.** Порядок выкладки на прод и обход сетевой особенности канала,
> из-за которой шаги деплоя рвались на середине.
>
> Актуально на 31 августа 2026. Все команды проверены на живом сервере.

---

## 1. Обязательная настройка `~/.ssh/config`

Без этого блока деплой рвётся: часть новых TCP-соединений до сервера теряется,
и каждый вызов `ssh` или `rsync` срабатывает не всегда. Замер 31.08.2026 —
1 успех из 5 попыток на новых соединениях против 8 из 8 внутри установленного.

```
Host getvoxly-vps
    HostName 150.241.98.135
    User root
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
    ControlMaster auto
    ControlPath ~/.ssh/cm-%r@%h:%p
    ControlPersist 10m
    ServerAliveInterval 30
    ServerAliveCountMax 6
```

`ControlMaster` держит одно соединение и пропускает через него все последующие
команды — переподключений, а значит и потерь, не возникает вовсе.

**Диагностика, если рвётся.** Отличить потерю канала от блокировки можно по
журналу: у блокировки в `journalctl -u ssh` нет вообще ничего от вашего адреса,
у бана fail2ban — адрес в `fail2ban-client status sshd`, у `MaxStartups` —
строки `Connection closed [preauth]`. При потере канала успех случаен: несколько
попыток подряд дают разный результат.

---

## 2. Деплой одной командой

```bash
sh scripts/deploy.sh all        # backend + frontend
sh scripts/deploy.sh backend    # только backend
sh scripts/deploy.sh frontend   # только frontend
```

Скрипт выполняет: типизацию и тесты → `rsync` → сборку образов → пересоздание
контейнеров → проверку. Останавливается на первой ошибке.

---

## 3. Что делает скрипт и почему именно так

| Шаг | Решение | Причина |
|---|---|---|
| Проверки | `tsc --noEmit` и `npm test` **до** `rsync` | иначе на прод уезжает код, который не собирается, и откатывать придётся живой сервис |
| Синхронизация | `--exclude .env` | на сервере рабочий файл с секретами, `--delete` снёс бы его |
| Сборка | отсоединённый процесс `remote-build.sh` | сборка frontend длиннее, чем живёт сессия при обрыве; `setsid` отвязывает процесс от терминала |
| Ожидание | по маркеру `BUILD_EXIT` в логе | время сборки зависит от кеша слоёв и загрузки машины, фиксированная пауза угадывает неверно |
| Пересоздание | `stop` + `rm` + `up`, **не** `restart` | `restart` переиспользует контейнер со старым образом, и свежая сборка не попадает на прод |
| Проверка | сначала изнутри сервера | внешний `000` может быть потерей пакета, и это не отличить от неработающего приложения |

Логи сборки на сервере: `/tmp/getvoxly-build-<service>.log`.

---

## 4. Ручной деплой, если скрипт недоступен

```bash
# 1. Проверки локально
cd backend && npx tsc --noEmit && npm test --silent && cd ..
cd frontend && npx tsc --noEmit && cd ..

# 2. Синхронизация
rsync -az --delete --exclude node_modules --exclude .git --exclude .env \
  -e ssh backend/ getvoxly-vps:/opt/getvoxly/backend/
rsync -az --delete --exclude node_modules --exclude .next --exclude .git \
  --exclude .env -e ssh frontend/ getvoxly-vps:/opt/getvoxly/frontend/

# 3. Сборка отсоединённым процессом
ssh getvoxly-vps "/opt/getvoxly/remote-build.sh backend"
ssh getvoxly-vps "tail -5 /tmp/getvoxly-build-backend.log"   # ждать BUILD_EXIT 0
ssh getvoxly-vps "/opt/getvoxly/remote-build.sh frontend"
ssh getvoxly-vps "tail -5 /tmp/getvoxly-build-frontend.log"

# 4. Пересоздание
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose stop backend frontend && \
  docker-compose rm -f backend frontend && docker-compose up -d"

# 5. Проверка
ssh getvoxly-vps "docker ps --filter name=getvoxly --format '{{.Names}} {{.Status}}'"
ssh getvoxly-vps "docker exec getvoxly-db-1 psql -U getvoxly -d getvoxly \
  -tAc 'SELECT count(*) FROM pgmigrations'"
curl -s https://api.getvoxly.ru/health
```

Миграции применяются автоматически при старте бэкенда — отдельного шага нет.

---

## 5. fail2ban: правила ослаблены 31.08.2026

Прежние пороги блокировали сам деплой. `rsync` и `docker-compose` открывают
соединения пачками, лишние отбрасываются по `MaxStartups`, и каждое отбрасывание
попадает в журнал как `Connection closed [preauth]` — фильтр `sshd` считает это
неудачной попыткой. При `maxretry = 4` рабочая машина уходила в бан на час за
собственную выкладку.

| Параметр | Было | Стало |
|---|---|---|
| `maxretry` | 4 | 10 |
| `bantime` | 1 час | 10 минут |
| `bantime.increment` | ×24 до недели | выключено |
| `MaxStartups` | `10:30:60` | `30:30:100` |
| `ignoreip` | только localhost | + адрес рабочей машины |

Защищённость почти не изменилась: пароли отключены (`PasswordAuthentication no`),
подбирать нечего. fail2ban здесь снимает нагрузку с `sshd`, а не предотвращает
вход.

Эталон конфига — `deploy/fail2ban-jail.local` в репозитории. Применение:

```bash
rsync -az -e ssh deploy/fail2ban-jail.local getvoxly-vps:/etc/fail2ban/jail.local
ssh getvoxly-vps "chown root:root /etc/fail2ban/jail.local && systemctl restart fail2ban"
ssh getvoxly-vps "fail2ban-client get sshd ignoreip"
```

`chown` обязателен: `rsync` сохраняет владельца исходного файла, и `jail.local`
достаётся несуществующему на сервере пользователю.

### Свой адрес брать из журнала, а не из ifconfig.me

```bash
ssh getvoxly-vps "journalctl -u ssh --no-pager --since '-10 min' | grep 'Accepted publickey'"
```

Проверено 31.08.2026: `ifconfig.me` показал `109.95.217.174`, тогда как SSH шёл
с `45.131.214.254` — HTTP и SSH выходят разными маршрутами. Адрес из
`ifconfig.me` в `ignoreip` защиты не даёт, банится фактический адрес SSH.

### Разбан через VNC-консоль провайдера

Если доступ уже потерян, SSH недоступен по определению — только консоль в панели
хостинга, вход `root` с паролем из `05_01_SERVER_ACCESS.md`:

```bash
fail2ban-client status sshd
fail2ban-client set sshd unbanip ВАШ_IP
```

---

## 6. Состояние после деплоя 31.08.2026

Выложено: паритет карточек записей с Twenty (`M7.5.1`–`M7.5.10`, `M7.5.12`,
`M7.5.14`–`M7.5.17`), включая исправление `createdByName` при создании записи,
которое оставалось незадеплоенным с 25 августа.

Проверено: три контейнера `healthy`, 19 миграций применены (последняя —
`0019_twenty_parity_fields_and_notes`), `localhost:3000/login` → `200`,
`localhost:4000/health` → `200`, снаружи `getvoxly.ru/login` отдаёт страницу
входа, `api.getvoxly.ru/health` → `{"status":"ok","database":"up"}`.

Локально до выкладки: `tsc --noEmit` без ошибок на обеих сторонах, 152 теста
бэкенда прошли.
