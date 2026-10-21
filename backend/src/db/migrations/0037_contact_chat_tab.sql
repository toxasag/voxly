-- Добавление вкладки «Чат» (MessageCircle) для контактов в page_layout_tabs.
-- Чат контакта позволяет вести переписку с клиентом во всех подключённых каналах (Telegram, MAX, WhatsApp, Webchat).

DO $$
DECLARE
  tenant_rec RECORD;
BEGIN
  FOR tenant_rec IN SELECT id FROM tenants
  LOOP
    INSERT INTO page_layout_tabs (
      tenant_id,
      object_type,
      tab_key,
      title,
      icon,
      position,
      is_active,
      module_slug,
      required_permission
    )
    VALUES (
      tenant_rec.id,
      'contact',
      'chat',
      'Чат',
      'MessageCircle',
      15,
      true,
      NULL,
      'contacts:write'
    )
    ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
      SET is_active = true, title = 'Чат', position = 15;
  END LOOP;
END;
$$;
