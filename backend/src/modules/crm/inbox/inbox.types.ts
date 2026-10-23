import { z } from "zod";

export interface InboxThreadDTO {
  id: string;
  dealId: string;
  dealTitle: string;
  dealBudget: number;
  stageName: string;
  contactId: string | null;
  contactName: string;
  contactPhone: string;
  telegramUsername: string;
  channel: string;
  lastMessage: string;
  lastMessageAt: string;
  lastSenderName: string;
  lastDirection: "inbound" | "outbound" | "neutral";
  unreadCount: number;
}

export const inboxQuerySchema = z.object({
  channel: z.enum(["all", "telegram", "whatsapp", "max", "webchat"]).optional().or(z.string()),
  unread_only: z
    .enum(["true", "false"])
    .optional()
    .transform((val) => val === "true"),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type InboxQueryParams = z.infer<typeof inboxQuerySchema>;
