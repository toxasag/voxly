# Voxly Platform — Twenty App

Расширение для Twenty CRM, добавляющее объекты Voxly:

- **BotSubscriber** — подписчики ботов (Telegram ID, username, телефон, этап воронки)
- **Conversation** — диалоги (платформа, статус, режим AI/оператор)
- **ChatMessage** — отдельные сообщения (роль, токены, стоимость)
- **GiftCampaign** — подарочные кампании (воронка, канал, статистика)
- **Broadcast** — рассылки (сообщение, расписание, статус доставки)

## Установка

1. В Twenty CRM перейдите в Settings → Apps
2. Найдите "Voxly Platform" в маркете
3. Установите приложение
4. Введите Tenant ID и API URL в настройках

## Webhooks

Приложение отправляет вебхуки в Control Plane:
- `botSubscriber.created` — синхронизация нового подписчика
- `conversation.updated` — уведомление об изменении статуса диалога
