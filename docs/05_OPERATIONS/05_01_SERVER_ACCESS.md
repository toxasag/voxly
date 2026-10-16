# 05_01 — Доступ к серверу и порядок восстановления

> **Назначение.** Этот документ отвечает на один вопрос: как попасть на сервер и что
> делать, если сайт не открывается. Читается в момент аварии, поэтому команды даны
> копипастой, без отсылок к другим документам.
>
> Актуально на 25 августа 2026.

---

## 1. Подключение по SSH

Короткая форма — алиас уже прописан в `~/.ssh/config` на рабочем MacBook:

```bash
ssh getvoxly-vps
```

Полная форма, если алиаса нет (новый компьютер, чужая машина):

```bash
ssh -i ~/.ssh/id_ed25519 root@150.241.98.135
```

| Параметр | Значение |
|---|---|
| IP | `150.241.98.135` |
| Порт | `22` |
| Пользователь | `root` |
| Аутентификация | **только SSH-ключ** `~/.ssh/id_ed25519` |
| Отпечаток ключа | `SHA256:MSmv6b7RWX0cJfDg1kBKm7tD/LhxRNnJpZx4573DnpA` (`antonsagajdak@MBP-Anton.Dlink`) |
| ОС | Ubuntu 22.04.5 LTS |
| Каталог проекта | `/opt/getvoxly` |

**Вход по паролю отключён намеренно** (см. раздел 6). Попытка войти паролем даёт
`Permission denied (publickey)` — это правильное поведение, а не поломка.

### Пароль root — только для консоли провайдера

```
LX4czWmauPDa4tnfoisQMsNDg0r0
```

Нужен исключительно для VNC-консоли в панели хостинга, когда сервер недоступен по
сети. По SSH не работает. Хранить в менеджере паролей, в переписке не пересылать.

### Подключение с другого компьютера

Надёжный путь — новый ключ, приватная часть не покидает машину, где создана:

```bash
ssh-keygen -t ed25519 -C "описание-машины"
ssh-copy-id -i ~/.ssh/id_ed25519.pub root@150.241.98.135   # выполняется с машины, где уже есть доступ
```

Быстрый путь — скопировать существующий ключ (менее безопасно, ключ путешествует):

```bash
scp ~/.ssh/id_ed25519 ~/.ssh/id_ed25519.pub user@новая-машина:~/.ssh/
```

---

## 2. Адреса и что где живёт

| Адрес | Назначение | Проверка |
|---|---|---|
| `https://getvoxly.ru/login` | Портал (апекс-домен) | `curl -s -o /dev/null -w "%{http_code}" https://getvoxly.ru/login` → `200` |
| `https://www.getvoxly.ru` | То же | `200` |
| `https://app.getvoxly.ru` | То же | `200` |
| `https://api.getvoxly.ru/health` | API бэкенда | `{"status":"ok","database":"up"}` |

Все четыре имени указывают на `150.241.98.135`.

**Важно про прокси.** Порты 80/443 держит **не системный nginx**, а контейнер
`automation-npm-1` (Nginx Proxy Manager) из стека automation. `systemctl status nginx`
покажет `inactive` — это нормально, искать проблему с доменами и сертификатами нужно
в NPM, а не в `/etc/nginx`.

---

## 3. Что запущено на сервере

Помимо GETVOXLY на машине живёт стек automation — он делит ресурсы с нами:

```
getvoxly-frontend-1     Next.js, порт 3000
getvoxly-backend-1      Fastify, порт 4000
getvoxly-db-1           PostgreSQL 16 + pgvector
automation-npm-1        Nginx Proxy Manager — держит 80/443 для ВСЕХ сайтов
automation-n8n-1        n8n
baserow                 Baserow (самый тяжёлый: ~1.8 ГБ)
automation-nocodb-1     NocoDB
automation-postgres-1   отдельный Postgres стека automation
automation-redis-1      Redis
```

Compose на сервере вызывается как **`docker-compose`** (v5.0.2), не `docker compose`.

---

## 4. Диагностика: сайт не открывается

Порядок проверок — от внешнего к внутреннему. Первый шаг, давший сбой, и есть уровень проблемы.

### Шаг 1. Отвечает ли сервер вообще

```bash
ping -c 3 150.241.98.135
ssh getvoxly-vps "uptime"
```

- **ping идёт, SSH виснет на `banner exchange`** → сервер парализован, ОС не даёт
  процессам CPU. Переходите к разделу 5, по SSH зайти не получится.
- **ping не идёт** → проблема сети провайдера либо машина выключена; смотрите панель хостинга.
- **SSH зашёл** → продолжайте.

### Шаг 2. Ресурсы

```bash
ssh getvoxly-vps "uptime; df -h /; free -m"
```

Норма в покое: load < 2, диск < 80%, свободно > 3 ГБ. Диск под 95% парализует Docker.

### Шаг 3. Контейнеры

```bash
ssh getvoxly-vps "docker ps -a --format '{{.Names}} | {{.Status}}'"
```

Все три `getvoxly-*` должны быть `Up ... (healthy)`. Если контейнер перезапускается:

```bash
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose logs --tail 100 backend"
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose logs --tail 100 frontend"
```

### Шаг 4. Приложение мимо прокси

```bash
ssh getvoxly-vps "curl -s -o /dev/null -w 'front %{http_code}\n' localhost:3000/login"
ssh getvoxly-vps "curl -s -o /dev/null -w 'api %{http_code}\n' localhost:4000/health"
```

Отвечают локально, но не снаружи → проблема в прокси `automation-npm-1`
(сертификат, проксируемый хост), а не в нашем коде.

### Шаг 5. Брутфорс

```bash
ssh getvoxly-vps "fail2ban-client status sshd"
ssh getvoxly-vps "journalctl -b --no-pager | grep -c 'Failed password'"
```

Сотни тысяч попыток — та самая авария 25 августа (см. раздел 6).

---

## 5. Сервер завис: ping идёт, ничего не отвечает

Признаки: ICMP отвечает стабильно, TCP-порты соединение принимают, но SSH не отдаёт
даже баннер версии, HTTP молчит десятки секунд. Ядро живо, пользовательские процессы
не получают процессорного времени.

**Изнутри это не лечится** — SSH недоступен, значит `docker` и `systemctl` выполнять негде.

Порядок действий:

1. **Панель хостинга → Reboot / Hard reset.** Мягкая перезагрузка не сработает:
   ей нужен работающий init, которому тоже не хватает ресурсов.
2. Если есть VNC-консоль, до перезагрузки снять причину (ввод идёт мимо sshd):
   ```
   df -h                 # заполнен ли диск
   free -m               # память и swap
   dmesg | tail -50      # следы OOM-killer
   journalctl -b --no-pager | grep -c 'Failed password'   # брутфорс
   ```
3. После загрузки контейнеры поднимаются сами (политика restart в compose).
   Проверить: `docker ps` и четыре адреса из раздела 2.

---

## 6. Инцидент 25 августа 2026 и защита

**Что было.** Сайт перестал отвечать, SSH не пускал. Причина — **188 758 попыток
подбора пароля SSH с 916 IP-адресов** за одну загрузку. `sshd` порождал процесс на
каждую попытку, userspace перестал получать CPU: ping отвечал (это делает ядро),
а sshd, прокси и Node — нет. Исходящий трафик умирал: DNS-запросы к 8.8.8.8 и
1.1.1.1 уходили в таймаут, NTP тоже.

Версия про нехватку ресурсов не подтвердилась: OOM в журнале нет, диск был занят на
37%, память свободна.

**Что настроено против повторения:**

| Мера | Значение |
|---|---|
| `fail2ban` | активен, jail `sshd`, `backend = systemd` |
| Порог бана | 4 неудачи за 10 минут |
| Срок бана | 1 час, с нарастанием ×24 за повтор, максимум неделя |
| `PasswordAuthentication` | `no` — вход только по ключу |
| `PermitRootLogin` | `prohibit-password` |
| `MaxAuthTries` | `3` |
| `MaxStartups` | `10:30:60` — лимит незавершённых сессий |
| Пароль root | сменён 25.08.2026 |
| Резервная копия конфига | `/etc/ssh/sshd_config.bak-2026-08-25` |

**Особенность конфигурации.** В `/etc/ssh/sshd_config` нет директивы `Include`,
поэтому файлы в `/etc/ssh/sshd_config.d/` **игнорируются** — правки вносятся только
в основной файл. Порядок безопасной правки:

```bash
ssh getvoxly-vps "cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak-$(date +%F)"
# ... правка ...
ssh getvoxly-vps "sshd -t"              # проверка синтаксиса ДО перезапуска
ssh getvoxly-vps "systemctl restart sshd"
ssh -o ControlPath=none getvoxly-vps "echo OK"   # проверка в НОВОМ соединении
```

Последний шаг обязателен: текущая сессия переживёт неудачный конфиг и создаст
иллюзию работоспособности.

### Если fail2ban забанил вас самих

Симптом: SSH перестал подключаться после нескольких неудачных попыток, у остальных
работает. Через VNC-консоль провайдера:

```bash
fail2ban-client status sshd                  # посмотреть список
fail2ban-client set sshd unbanip ВАШ_IP      # снять бан
```

Свой статический адрес можно внести в белый список — `ignoreip` в
`/etc/fail2ban/jail.local`, затем `systemctl restart fail2ban`.

---

## 7. Частые операции

```bash
# Состояние
ssh getvoxly-vps "docker ps --filter name=getvoxly --format '{{.Names}} {{.Status}}'"

# Логи
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose logs -f --tail 100 backend"

# Перезапуск сервиса
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose restart backend"

# Применённые миграции
ssh getvoxly-vps "docker exec getvoxly-db-1 psql -U getvoxly -d getvoxly -tAc \
  'SELECT name FROM pgmigrations ORDER BY id DESC LIMIT 5;'"

# Освободить место после сборок
ssh getvoxly-vps "docker image prune -af && docker builder prune -af && df -h /"

# Бан-лист
ssh getvoxly-vps "fail2ban-client status sshd"
```

### Деплой

```bash
# 1. Синхронизация
rsync -az --delete --exclude node_modules --exclude .next --exclude .git \
  ~/Desktop/GETVOXLY/frontend/ getvoxly-vps:/opt/getvoxly/frontend/
rsync -az --delete --exclude node_modules --exclude .git \
  ~/Desktop/GETVOXLY/backend/ getvoxly-vps:/opt/getvoxly/backend/

# 2. Сборка (по одному сервису: машина делится со стеком automation)
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose build --no-cache backend"
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose build --no-cache frontend"

# 3. Пересоздание
ssh getvoxly-vps "cd /opt/getvoxly && docker-compose stop backend frontend && \
  docker-compose rm -f backend frontend && docker-compose up -d"

# 4. Проверка
curl -s -o /dev/null -w "%{http_code}\n" https://getvoxly.ru/login
curl -s https://api.getvoxly.ru/health
```

Миграции применяются автоматически при старте бэкенда — журнал в таблице `pgmigrations`.
