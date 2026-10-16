import type { MarketplaceModule, ReferralStats, ReferralPayout } from "@/types";

export const MOCK_MARKETPLACE_MODULES: MarketplaceModule[] = [
  {
    id: "mod-crm",
    slug: "core_crm",
    name: "Core CRM",
    description: "Contacts, companies, deals pipeline with Kanban board and timeline.",
    icon: "Users",
    price: "Free",
    price_period: "",
    features: ["Unlimited contacts", "Deal Kanban board", "Chat timeline", "Custom fields (JSONB)"],
    installed: true,
    category: "crm",
  },
  {
    id: "mod-service",
    slug: "service_center",
    name: "Service Center",
    description: "Repair ticket management, diagnostics, work tracking, parts inventory.",
    icon: "Wrench",
    price: "1 990 ₽",
    price_period: "per month",
    features: ["Equipment intake", "Diagnostics workflow", "Work & parts tracking", "Printable receipts"],
    installed: true,
    category: "service",
  },
  {
    id: "mod-finance",
    slug: "finance",
    name: "Finance & Invoices",
    description: "Management accounting, bank accounts, invoices, P&L reports.",
    icon: "Receipt",
    price: "2 490 ₽",
    price_period: "per month",
    features: ["3 cash accounts", "Transactions journal", "Invoice generator", "P&L reports"],
    installed: true,
    category: "finance",
  },
  {
    id: "mod-ai",
    slug: "ai_bots",
    name: "AI Auto-responder",
    description: "AI assistant for deal chat: suggest replies or auto-respond to clients.",
    icon: "MessageCircle",
    price: "3 990 ₽",
    price_period: "per month",
    features: ["Deal chat integration", "Prompt templates", "Multi-model support", "Token usage dashboard"],
    installed: false,
    category: "ai",
  },
  {
    id: "mod-telegram",
    slug: "telegram_gateway",
    name: "GramJS Telegram Gateway",
    description: "Native Telegram integration via GramJS. Send & receive messages directly.",
    icon: "Send",
    price: "1 490 ₽",
    price_period: "per month",
    features: ["Telegram messaging", "Media attachments", "Automated welcome", "Session management"],
    installed: false,
    category: "integration",
  },
  {
    id: "mod-whatsapp",
    slug: "whatsapp_gateway",
    name: "WhatsApp Gateway",
    description: "WhatsApp Business API integration for messaging and notifications.",
    icon: "PhoneForwarded",
    price: "2 990 ₽",
    price_period: "per month",
    features: ["WhatsApp messaging", "Template messages", "Media sharing", "Green-tick verified"],
    installed: false,
    category: "integration",
  },
];

// MOCK_AI_AGENTS удалён: агенты хранятся в БД (`ai_agents`, миграция 0014) и
// читаются через `useAiAgents`. Захардкоженный «Помощник по продажам» показывался
// одинаково всем арендаторам и не соответствовал ни одной реальной записи.

export const MOCK_REFERRAL_STATS: ReferralStats = {
  referral_code: "GETVOX-ACME-01",
  referral_link: "https://getvoxly.com/ref/GETVOX-ACME-01",
  total_invited: 3,
  total_earned: 45000,
  available_payout: 25000,
};

export const MOCK_REFERRAL_PAYOUTS: ReferralPayout[] = [
  { id: "rp1", amount: 15000, currency: "RUB", status: "completed", method: "Банковский перевод", created_at: "2026-07-15T10:00:00Z", paid_at: "2026-07-20T14:00:00Z" },
  { id: "rp2", amount: 10000, currency: "RUB", status: "pending", method: "На карту", created_at: "2026-08-10T09:00:00Z", paid_at: null },
  { id: "rp3", amount: 20000, currency: "RUB", status: "completed", method: "Банковский перевод", created_at: "2026-08-01T11:00:00Z", paid_at: "2026-08-05T16:00:00Z" },
];