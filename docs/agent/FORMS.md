# Приём заявок с сайта (Tilda / WordPress)

Клиентская инструкция (кратко). Product ADR: **ADR-026**.

## URL

В кабинете CRM → «Приём заявок с сайта» → скопировать webhook URL:

`https://api.getvoxly.ru/api/webhooks/forms/{token}`

Опциональный секрет: заголовок `X-Voxly-Webhook-Secret` (или поле/query `api_key` / `secret` — удобно для Tilda API key).

## Tilda

1. Настройки сайта → Формы → Webhook → вставить URL.
2. Включить **«Посылать Cookie»** (нужны `_ym_uid` и `TILDAUTM` для склейки с Метрикой клиента).
3. При сохранении Tilda шлёт `test=test` — ожидается HTTP 200 за ≤5 сек.
4. В блоке формы отметить сервис Webhook, опубликовать.

Служебные поля: `tranid` (идемпотентность), `formid`. Повтор того же `tranid` не создаёт вторую сделку.

## WordPress / JSON

Тот же URL, `Content-Type: application/json`:

```json
{
  "name": "Иван",
  "phone": "+79001234567",
  "email": "ivan@example.com",
  "comment": "Хочу консультацию",
  "entry_id": "12345",
  "utm_source": "yandex",
  "_ym_uid": "…"
}
```

Gravity Forms Webhooks Add-On / CF7 webhook / n8n → POST на URL + header с секретом.

## Что происходит в Voxly

1. Быстрый 200 + запись `FormLead`.
2. Async: Person (дедуп телефон → email) + Opportunity (по умолчанию одна открытая на контакт).
3. `AttributionSession` + цель аналитики `web_form_lead` (клиентские Metrika/GA4/FB/VK из `/api/analytics`, не счётчик getvoxly.ru).

Платформенная Метрика на лендинге Voxly ≠ интеграции тенанта.
