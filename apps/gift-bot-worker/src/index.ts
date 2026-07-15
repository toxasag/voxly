// Voxly Gift Bot Worker
// Handles all tenant gift bots via multi-tenant webhook routing
// Path: /tg/{tenantId}/{botId}

import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { fireGoal } from '@voxly/analytics-dispatchers';
import { TwentyClient } from '@voxly/twenty-client';
import type { ConversationMode } from '@voxly/shared';

const PORT = 3004;

// Funnel step type
interface FunnelStep {
  step_id: string;
  condition?: string; // text match, button click, etc.
  message?: string;
  buttons?: Array<{ text: string; type: 'inline' | 'phone'; url?: string; callback?: string }>;
  attachment_type?: 'text' | 'image' | 'video' | 'file';
  attachment_url?: string;
  timeout_minutes?: number;
  next_step?: string;
  goals?: string[]; // analytics goals to fire
  check_subscription?: {
    channel_id: string;
    on_verified: string; // next step
    on_not_verified: string; // next step
  };
  collect_phone?: {
    on_valid: string;
    on_invalid: string;
  };
}

async function main() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/tg/')) {
      // Parse path: /tg/{tenantId}/{botId}
      const parts = req.url.split('/').filter(Boolean);
      const tenantId = parts[1];
      const botId = parts[2];

      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const update = JSON.parse(body);
        await handleTelegramUpdate(update, tenantId, botId);
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        console.error('[gift-bot] Error:', err);
        res.writeHead(500);
        res.end('error');
      }
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(PORT, () => {
    console.log(`[gift-bot-worker] Listening on port ${PORT}`);
  });
}

/**
 * Handle a Telegram update for a specific tenant's bot
 */
async function handleTelegramUpdate(update: any, tenantId: string, botId: string) {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, status: 'active' },
    include: { giftCampaigns: { where: { isActive: true }, take: 1 } },
  });

  if (!bot || !bot.botTokenEncrypted) {
    console.warn(`[gift-bot] Bot not found or inactive: ${botId}`);
    return;
  }

  const botToken = decrypt(bot.botTokenEncrypted);
  const botApi = `https://api.telegram.org/bot${botToken}`;
  const campaign = bot.giftCampaigns[0];

  // Handle /start
  if (update.message?.text === '/start' || update.message?.text?.startsWith('/start ')) {
    await handleStart(update, botApi, tenantId, botId, campaign, botToken);
    return;
  }

  // Handle callback query (button press)
  if (update.callback_query) {
    await handleCallback(update, botApi, tenantId, botId, campaign);
    return;
  }

  // Handle regular text message (phone number collection, etc.)
  if (update.message?.text) {
    await handleTextMessage(update, botApi, tenantId, botId, campaign);
    return;
  }

  // Handle contact (phone number via button)
  if (update.message?.contact) {
    await handleContact(update, botApi, tenantId, botId, campaign);
    return;
  }
}

/**
 * Handle /start command
 */
async function handleStart(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
  botToken: string,
) {
  const chatId = update.message.chat.id;
  const telegramId = update.message.from.id;
  const username = update.message.from.username;
  const firstName = update.message.from.first_name;
  const startPayload = update.message.text?.split(' ')[1];

  // Fire bot_start goal
  await fireGoal({
    tenantId,
    goalName: 'bot_start',
    subscriberId: String(telegramId),
    attribution: parseAttributionFromStart(startPayload),
  });

  // Upsert subscriber in Twenty CRM (create Person + Opportunity)
  await createOrUpdateSubscriberInCRM(tenantId, telegramId, username, firstName);

  if (!campaign) {
    await sendBotMessage(botApi, chatId, 'Привет! Бот настроен и готов к работе.');
    return;
  }

  const funnel = campaign.funnelJson as any;
  const firstStep = funnel.steps?.[0];
  if (firstStep) {
    await executeFunnelStep(botApi, chatId, firstStep, tenantId, telegramId, campaign);
  }
}

/**
 * Handle callback query (button press)
 */
async function handleCallback(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
) {
  const callbackData = update.callback_query.data;
  const chatId = update.callback_query.message.chat.id;
  const telegramId = update.callback_query.from.id;

  // Answer callback to remove loading state
  await fetch(`${botApi}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: update.callback_query.id }),
  });

  if (!campaign) return;

  const funnel = campaign.funnelJson as any;

  // Handle "Я подписался" button — check subscription
  if (callbackData === 'check_subscription' || callbackData === 'Я подписался ✅') {
    await fireGoal({
      tenantId,
      goalName: 'subscription_requested',
      subscriberId: String(telegramId),
    });

    // Find the step with check_subscription
    const checkStep = funnel.steps?.find((s: FunnelStep) => s.check_subscription);
    if (checkStep?.check_subscription) {
      const isMember = await checkChannelSubscription(
        botApi,
        checkStep.check_subscription.channel_id,
        telegramId,
      );

      if (isMember) {
        await fireGoal({
          tenantId,
          goalName: 'subscription_verified',
          subscriberId: String(telegramId),
        });
        // Go to verified step (deliver gift)
        const verifiedStep = funnel.steps?.find((s: FunnelStep) => s.step_id === checkStep.check_subscription!.on_verified);
        if (verifiedStep) {
          await executeFunnelStep(botApi, chatId, verifiedStep, tenantId, telegramId, campaign);
        }
      } else {
        // Not subscribed — go to not_verified step
        const notVerifiedStep = funnel.steps?.find((s: FunnelStep) => s.step_id === checkStep.check_subscription!.on_not_verified);
        if (notVerifiedStep) {
          await executeFunnelStep(botApi, chatId, notVerifiedStep, tenantId, telegramId, campaign);
        }
      }
    }
    return;
  }

  // Handle other button callbacks (navigate to step)
  const targetStep = funnel.steps?.find((s: FunnelStep) => s.step_id === callbackData || s.condition === callbackData);
  if (targetStep) {
    await executeFunnelStep(botApi, chatId, targetStep, tenantId, telegramId, campaign);
  }
}

/**
 * Handle text message (phone number validation)
 */
async function handleTextMessage(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
) {
  const chatId = update.message.chat.id;
  const text = update.message.text;
  const telegramId = update.message.from.id;

  if (!campaign) return;

  const funnel = campaign.funnelJson as any;

  // Check if any step is collecting phone
  const phoneStep = funnel.steps?.find((s: FunnelStep) => s.collect_phone);
  if (phoneStep?.collect_phone) {
    const phoneRegex = /^(\+7|7|8)\d{10}$/;
    if (phoneRegex.test(text)) {
      // Valid phone — fire goal and create lead
      await fireGoal({
        tenantId,
        goalName: 'phone_submitted',
        subscriberId: String(telegramId),
      });

      await createLeadInCRM(tenantId, telegramId, text);

      const validStep = funnel.steps?.find((s: FunnelStep) => s.step_id === phoneStep.collect_phone!.on_valid);
      if (validStep) {
        await executeFunnelStep(botApi, chatId, validStep, tenantId, telegramId, campaign);
      }
    } else {
      const invalidStep = funnel.steps?.find((s: FunnelStep) => s.step_id === phoneStep.collect_phone!.on_invalid);
      if (invalidStep) {
        await executeFunnelStep(botApi, chatId, invalidStep, tenantId, telegramId, campaign);
      }
    }
  }
}

/**
 * Handle contact sharing (phone via button)
 */
async function handleContact(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
) {
  const chatId = update.message.chat.id;
  const phone = update.message.contact.phone_number;
  const telegramId = update.message.from.id;

  await fireGoal({
    tenantId,
    goalName: 'phone_submitted',
    subscriberId: String(telegramId),
  });

  await createLeadInCRM(tenantId, telegramId, phone);

  if (!campaign) return;
  const funnel = campaign.funnelJson as any;
  const phoneStep = funnel.steps?.find((s: FunnelStep) => s.collect_phone);
  if (phoneStep?.collect_phone) {
    const validStep = funnel.steps?.find((s: FunnelStep) => s.step_id === phoneStep.collect_phone!.on_valid);
    if (validStep) {
      await executeFunnelStep(botApi, chatId, validStep, tenantId, telegramId, campaign);
    }
  }
}

/**
 * Execute a single funnel step: send message, attachment, buttons
 */
async function executeFunnelStep(
  botApi: string,
  chatId: number,
  step: FunnelStep,
  tenantId: string,
  telegramId: number,
  campaign: any,
) {
  // Fire goals for this step
  if (step.goals) {
    for (const goal of step.goals) {
      await fireGoal({
        tenantId,
        goalName: goal,
        subscriberId: String(telegramId),
      });
    }
  }

  // Send message with buttons
  const buttons = step.buttons
    ? {
        inline_keyboard: step.buttons.map((b, i) => {
          if (b.type === 'phone') {
            return [{
              text: b.text,
              request_contact: true,
            }];
          }
          return [{
            text: b.text,
            callback_data: b.callback || b.text,
            ...(b.url ? { url: b.url } : {}),
          }];
        }),
      }
    : undefined;

  // Send attachment based on type
  if (step.attachment_type === 'file' && step.attachment_url) {
    await sendBotDocument(botApi, chatId, step.attachment_url, step.message || '', buttons);
    // Fire gift_delivered goal
    await fireGoal({
      tenantId,
      goalName: 'gift_delivered',
      subscriberId: String(telegramId),
    });
  } else if (step.attachment_type === 'video' && step.attachment_url) {
    await sendBotVideo(botApi, chatId, step.attachment_url, step.message || '', buttons);
    await fireGoal({
      tenantId,
      goalName: 'gift_delivered',
      subscriberId: String(telegramId),
    });
  } else if (step.message) {
    await sendBotMessage(botApi, chatId, step.message, buttons);
  }
}

/**
 * Check if user is subscribed to a Telegram channel
 */
async function checkChannelSubscription(botApi: string, channelId: string, userId: number): Promise<boolean> {
  try {
    const response = await fetch(`${botApi}/getChatMember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: channelId, user_id: userId }),
    });
    const data = await response.json() as any;
    if (data.ok) {
      const status = data.result.status;
      return status === 'member' || status === 'creator' || status === 'administrator';
    }
    return false;
  } catch (err) {
    console.error('[gift-bot] checkChannelSubscription error:', err);
    return false;
  }
}

/**
 * Create or update subscriber in Twenty CRM (Person + Opportunity)
 */
async function createOrUpdateSubscriberInCRM(
  tenantId: string,
  telegramId: number,
  username?: string,
  firstName?: string,
) {
  try {
    const twenty = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
      apiKey: process.env.TWENTY_API_KEY,
    });

    // Create Person
    await twenty.createPerson({
      firstName: firstName || username || `Telegram ${telegramId}`,
      lastName: username ? `@${username}` : undefined,
    });
  } catch (err) {
    console.error('[gift-bot] CRM sync error:', err);
    // Non-fatal — bot continues working even if CRM sync fails
  }
}

/**
 * Create a lead (Opportunity) in Twenty CRM
 */
async function createLeadInCRM(tenantId: string, telegramId: number, phone: string) {
  try {
    const twenty = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
      apiKey: process.env.TWENTY_API_KEY,
    });

    await twenty.createPerson({
      phone,
      firstName: `Telegram ${telegramId}`,
    });

    await fireGoal({
      tenantId,
      goalName: 'lead_created',
      subscriberId: String(telegramId),
    });
  } catch (err) {
    console.error('[gift-bot] Lead creation error:', err);
  }
}

// ============================================================
// Telegram Bot API helpers
// ============================================================

async function sendBotMessage(botApi: string, chatId: number, text: string, replyMarkup?: any) {
  await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function sendBotDocument(botApi: string, chatId: number, url: string, caption: string, replyMarkup?: any) {
  await fetch(`${botApi}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      document: url,
      caption,
      parse_mode: 'Markdown',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function sendBotVideo(botApi: string, chatId: number, url: string, caption: string, replyMarkup?: any) {
  await fetch(`${botApi}/sendVideo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      video: url,
      caption,
      parse_mode: 'Markdown',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

function parseAttributionFromStart(payload?: string) {
  if (!payload || !payload.startsWith('tr_')) return undefined;
  // In production, look up attribution_session by click_id
  return {
    utmSource: 'tracking_link',
  };
}

main().catch(console.error);
