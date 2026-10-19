import { z } from "zod";

export const timelineRecordTypeSchema = z.enum(["deal", "contact", "company"]);
export type TimelineRecordType = z.infer<typeof timelineRecordTypeSchema>;

export const timelineEventTypeSchema = z.enum(["message", "note", "task", "stage_change"]);
export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;

export interface TimelineEventDTO {
  id: string;
  type: TimelineEventType;
  createdAt: string;
  authorId?: string | null;
  authorName?: string | null;
  data: Record<string, unknown>;
}

export interface TimelineListResponse {
  items: TimelineEventDTO[];
  total: number;
  limit: number;
  offset: number;
}
