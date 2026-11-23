-- =============================================================================
-- 0129: Расширение индивидуальных квот и полный безлимит для главного портала (Root)
-- =============================================================================

DO $$
DECLARE
  v_root_id UUID;
  v_features TEXT[] := ARRAY[
    'webchat_widgets',
    'site_integrations',
    'ai_agents',
    'telegram_channels',
    'telegram_bot_channels',
    'whatsapp_channels',
    'max_channels',
    'max_bot_channels',
    'avito_channels',
    'instagram_channels',
    'custom_pipelines'
  ];
  v_feat TEXT;
BEGIN
  SELECT id INTO v_root_id FROM tenants WHERE slug = 'voxly' OR id = 'c0000000-0000-0000-0000-000000000001' LIMIT 1;
  IF v_root_id IS NOT NULL THEN
    FOREACH v_feat IN ARRAY v_features LOOP
      INSERT INTO tenant_feature_quotas (tenant_id, feature_key, is_unlimited, max_limit, updated_at)
      VALUES (v_root_id, v_feat, true, -1, now())
      ON CONFLICT (tenant_id, feature_key) DO UPDATE
      SET is_unlimited = true,
          max_limit = -1,
          updated_at = now();
    END LOOP;

    -- Снятие всех ограничений в installed_modules для корневого портала
    INSERT INTO installed_modules (tenant_id, slug, name, quantity)
    VALUES
      (v_root_id, 'webchat', 'Онлайн-чат на сайт', 999999),
      (v_root_id, 'ai_bots', 'AI-агенты', 999999),
      (v_root_id, 'telegram', 'Telegram', 999999),
      (v_root_id, 'telegram_bot', 'Telegram-бот компании', 999999),
      (v_root_id, 'whatsapp', 'WhatsApp', 999999),
      (v_root_id, 'max', 'MAX', 999999),
      (v_root_id, 'max_bot', 'MAX-бот компании', 999999),
      (v_root_id, 'avito', 'Avito', 999999),
      (v_root_id, 'instagram', 'Instagram', 999999)
    ON CONFLICT (tenant_id, slug) DO UPDATE
    SET quantity = 999999;
  END IF;
END $$;
