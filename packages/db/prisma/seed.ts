// Voxly Control Plane — Prisma seed
// Seeds initial platform settings, default referral rule, and super-admin user

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // =====================================
  // Platform settings
  // =====================================
  const settings = [
    { key: 'ai_markup_percent', value: '50', description: 'AI token markup percentage (default 50%)' },
    { key: 'usd_rub_rate', value: '90', description: 'USD→RUB rate for OpenRouter provider cost (override via USD_RUB_RATE env)' },
    // OpenRouter model matrix (TZ v0.3.1) — upsert updates value so re-seed picks new defaults
    { key: 'ai_default_model', value: 'google/gemini-2.5-flash', description: 'Default OpenRouter chat model' },
    { key: 'ai_chat_model', value: 'google/gemini-2.5-flash', description: 'Primary chat model (OpenRouter id)' },
    { key: 'ai_chat_model_economy', value: 'openai/gpt-4o-mini', description: 'Economy chat model (OpenRouter id)' },
    { key: 'ai_chat_model_fallback', value: 'openai/gpt-4o', description: 'Premium / fallback chat model (OpenRouter id)' },
    { key: 'ai_embedding_model', value: 'openai/text-embedding-3-small', description: 'Embeddings model (OpenRouter id)' },
    { key: 'ai_asr_model', value: 'openai/whisper-1', description: 'ASR / whisper model id' },
    { key: 'ai_default_system_prompt', value: 'Ты — дружелюбный ассистент, который помогает клиентам. Отвечай кратко, по делу и на русском языке.', description: 'Default system prompt' },
    { key: 'subscription_base_price', value: '500', description: 'Base subscription price (RUB/month)' },
    { key: 'subscription_seats_included', value: '10', description: 'Seats included in base subscription' },
    { key: 'extra_seat_price', value: '300', description: 'Price per extra seat (RUB/month)' },
    { key: 'gift_bot_price', value: '500', description: 'Gift bot add-on price (RUB/month per channel)' },
    { key: 'ai_telegram_price', value: '1000', description: 'AI Telegram add-on price (RUB/month per 10 Business accounts)' },
    { key: 'ai_whatsapp_price', value: '500', description: 'AI WhatsApp add-on price (RUB/month per number)' },
    { key: 'analytics_price', value: '500', description: 'Analytics add-on price (RUB/month per platform)' },
    { key: 'subscription_grace_days', value: '7', description: 'Grace period before suspending expired subscription' },
    { key: 'ai_low_balance_threshold', value: '50', description: 'Low balance threshold for AI wallet (RUB)' },
    { key: 'referral_default_reward_type', value: 'credit', description: 'Default referral reward type' },
    { key: 'referral_default_reward_value', value: '500', description: 'Default referral reward value (RUB credit)' },
    { key: 'referral_reward_recipient', value: 'referrer', description: 'Who gets the reward: referrer or referred' },
  ];

  for (const s of settings) {
    await prisma.platformSetting.upsert({
      where: { key: s.key },
      create: s,
      update: { value: s.value, description: s.description },
    });
  }
  console.log(`✓ Seeded ${settings.length} platform settings`);

  // =====================================
  // Default referral rule
  // =====================================
  await prisma.referralRule.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      type: 'percent_recurring',
      value: 20,
      productScope: 'all',
      isDefault: true,
      isActive: true,
    },
    update: {
      type: 'percent_recurring',
      value: 20,
      productScope: 'all',
      isDefault: true,
      isActive: true,
    },
  });
  console.log('✓ Seeded default referral rule (20% recurring, excl. AI top-up)');

  // =====================================
  // Super-admin user
  // =====================================
  const adminEmail = process.env.SUPERADMIN_EMAIL || 'admin@getvoxly.ru';
  const adminPassword = process.env.SUPERADMIN_PASSWORD || 'changeme';

  // We don't hash the password here — the API handles hashing on first login
  // or you can run a separate script to set it
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        email: adminEmail,
        passwordHash: hashedPassword,
        firstName: 'Super',
        lastName: 'Admin',
        role: 'superadmin',
      },
    });
    console.log(`✓ Created super-admin: ${adminEmail}`);
    console.log('  ⚠️  Please change the password immediately!');
  } else {
    // Ensure existing admin has superadmin role and a bcrypt password hash
    const hashedPassword = existingAdmin.passwordHash.startsWith('$2')
      ? existingAdmin.passwordHash
      : await bcrypt.hash(adminPassword, 12);
    await prisma.user.update({
      where: { email: adminEmail },
      data: {
        role: 'superadmin',
        passwordHash: hashedPassword,
      },
    });
    console.log(`✓ Super-admin already exists: ${adminEmail}`);
  }

  // =====================================
  // Default gift bot funnel preset
  // =====================================
  const defaultFunnel = {
    steps: [
      {
        step_id: 'welcome',
        message: '👋 Привет! Чтобы получить подарок, подпишитесь на наш канал:',
        buttons: [
          { text: 'Открыть канал', type: 'inline', url: 'https://t.me/your_channel' },
          { text: 'Я подписался ✅', type: 'inline', callback: 'check_subscription' },
        ],
        check_subscription: {
          channel_id: '@your_channel',
          on_verified: 'collect_phone',
          on_not_verified: 'not_subscribed',
        },
      },
      {
        step_id: 'not_subscribed',
        message: '❌ Вы ещё не подписались на канал. Пожалуйста, подпишитесь и нажмите кнопку снова.',
        buttons: [
          { text: 'Открыть канал', type: 'inline', url: 'https://t.me/your_channel' },
          { text: 'Я подписался ✅', type: 'inline', callback: 'check_subscription' },
        ],
      },
      {
        step_id: 'collect_phone',
        message: '🎁 Отлично! Вы подписались. Чтобы получить подарок, оставьте ваш номер телефона:',
        buttons: [
          { text: '📱 Отправить номер', type: 'phone' },
        ],
        collect_phone: {
          on_valid: 'deliver_gift',
          on_invalid: 'invalid_phone',
        },
      },
      {
        step_id: 'invalid_phone',
        message: '❌ Неверный формат номера. Пожалуйста, отправьте номер в формате +7XXXXXXXXXX',
        buttons: [
          { text: '📱 Отправить номер', type: 'phone' },
        ],
      },
      {
        step_id: 'deliver_gift',
        message: '🎉 Вот ваш подарок! Спасибо за подписку!',
        attachment_type: 'file',
        attachment_url: 'https://example.com/gift.pdf',
        goals: ['gift_delivered'],
      },
    ],
  };

  await prisma.platformSetting.upsert({
    where: { key: 'default_gift_funnel' },
    create: {
      key: 'default_gift_funnel',
      value: JSON.stringify(defaultFunnel),
      description: 'Default gift bot funnel preset',
    },
    update: {
      value: JSON.stringify(defaultFunnel),
    },
  });
  console.log('✓ Seeded default gift funnel preset');

  console.log('\n✅ Seed completed successfully');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
