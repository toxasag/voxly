// Voxly Platform — Twenty App objects definition
// Defines BotSubscriber, Conversation, ChatMessage objects

export const objects = [
  {
    nameSingular: 'botSubscriber',
    namePlural: 'botSubscribers',
    labelSingular: 'Bot Subscriber',
    labelPlural: 'Bot Subscribers',
    icon: 'user',
    fields: [
      {
        name: 'telegramId',
        label: 'Telegram ID',
        type: 'text',
        description: 'Telegram user ID',
      },
      {
        name: 'username',
        label: 'Username',
        type: 'text',
        description: 'Telegram @username',
      },
      {
        name: 'firstName',
        label: 'First Name',
        type: 'text',
      },
      {
        name: 'phone',
        label: 'Phone',
        type: 'phone',
      },
      {
        name: 'subscribedAt',
        label: 'Subscribed At',
        type: 'date',
      },
      {
        name: 'subscriptionVerified',
        label: 'Subscription Verified',
        type: 'boolean',
      },
      {
        name: 'funnelStep',
        label: 'Funnel Step',
        type: 'text',
        description: 'Current step in the gift funnel',
      },
      {
        name: 'tags',
        label: 'Tags',
        type: 'multiSelect',
        options: ['lead', 'customer', 'gift_delivered', 'human_handoff'],
      },
      {
        name: 'source',
        label: 'Source',
        type: 'text',
        description: 'Attribution source (utm/tracking link)',
      },
    ],
  },
  {
    nameSingular: 'conversation',
    namePlural: 'conversations',
    labelSingular: 'Conversation',
    labelPlural: 'Conversations',
    icon: 'chat',
    fields: [
      {
        name: 'platform',
        label: 'Platform',
        type: 'select',
        options: ['telegram', 'whatsapp'],
      },
      {
        name: 'platformUserId',
        label: 'Platform User ID',
        type: 'text',
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: ['open', 'waiting_for_human', 'resolved', 'closed'],
      },
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        options: ['ai', 'human'],
      },
      {
        name: 'assignedTo',
        label: 'Assigned To',
        type: 'relation',
        relation: 'user',
      },
      {
        name: 'lastMessageAt',
        label: 'Last Message At',
        type: 'date',
      },
      {
        name: 'aiTokensUsed',
        label: 'AI Tokens Used',
        type: 'number',
      },
      {
        name: 'aiCostRub',
        label: 'AI Cost (RUB)',
        type: 'number',
      },
    ],
  },
  {
    nameSingular: 'chatMessage',
    namePlural: 'chatMessages',
    labelSingular: 'Chat Message',
    labelPlural: 'Chat Messages',
    icon: 'message',
    fields: [
      {
        name: 'conversation',
        label: 'Conversation',
        type: 'relation',
        relation: 'conversation',
      },
      {
        name: 'role',
        label: 'Role',
        type: 'select',
        options: ['user', 'assistant', 'system', 'operator'],
      },
      {
        name: 'content',
        label: 'Content',
        type: 'text',
      },
      {
        name: 'tokensUsed',
        label: 'Tokens Used',
        type: 'number',
      },
      {
        name: 'modelUsed',
        label: 'Model',
        type: 'text',
      },
      {
        name: 'costRub',
        label: 'Cost (RUB)',
        type: 'number',
      },
      {
        name: 'sentAt',
        label: 'Sent At',
        type: 'date',
      },
    ],
  },
  {
    nameSingular: 'giftCampaign',
    namePlural: 'giftCampaigns',
    labelSingular: 'Gift Campaign',
    labelPlural: 'Gift Campaigns',
    icon: 'gift',
    fields: [
      {
        name: 'name',
        label: 'Campaign Name',
        type: 'text',
      },
      {
        name: 'bot',
        label: 'Bot',
        type: 'relation',
        relation: 'botSubscriber',
      },
      {
        name: 'channelId',
        label: 'Channel ID',
        type: 'text',
        description: 'Telegram channel to verify subscription',
      },
      {
        name: 'funnelJson',
        label: 'Funnel Configuration',
        type: 'json',
      },
      {
        name: 'isActive',
        label: 'Active',
        type: 'boolean',
      },
      {
        name: 'startedAt',
        label: 'Started At',
        type: 'date',
      },
      {
        name: 'subscribersCount',
        label: 'Subscribers Count',
        type: 'number',
      },
      {
        name: 'giftsDelivered',
        label: 'Gifts Delivered',
        type: 'number',
      },
    ],
  },
  {
    nameSingular: 'broadcast',
    namePlural: 'broadcasts',
    labelSingular: 'Broadcast',
    labelPlural: 'Broadcasts',
    icon: 'megaphone',
    fields: [
      {
        name: 'campaign',
        label: 'Campaign',
        type: 'relation',
        relation: 'giftCampaign',
      },
      {
        name: 'message',
        label: 'Message',
        type: 'text',
      },
      {
        name: 'attachmentUrl',
        label: 'Attachment URL',
        type: 'text',
      },
      {
        name: 'scheduledAt',
        label: 'Scheduled At',
        type: 'date',
      },
      {
        name: 'sentAt',
        label: 'Sent At',
        type: 'date',
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: ['draft', 'scheduled', 'sending', 'sent', 'failed'],
      },
      {
        name: 'recipientsCount',
        label: 'Recipients',
        type: 'number',
      },
      {
        name: 'deliveredCount',
        label: 'Delivered',
        type: 'number',
      },
    ],
  },
];
