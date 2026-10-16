import { z } from "zod";

export const pageLayoutObjectTypeSchema = z.enum(["contact", "company", "deal"]);

export const pageLayoutTabSchema = z
  .object({
    tabKey: z.string().regex(/^[a-z][a-z0-9_-]*$/).min(1).max(64),
    title: z.string().min(1).max(100),
    icon: z.string().min(1).max(64),
    position: z.number().finite(),
    isActive: z.boolean(),
    moduleSlug: z.string().min(1).max(64).nullable(),
    requiredPermission: z.string().min(1).max(100).nullable(),
  })
  .strict();

export const updatePageLayoutTabSchema = z
  .object({
    title: z.string().min(1).max(100).optional(),
    icon: z.string().min(1).max(64).optional(),
    position: z.number().finite().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type PageLayoutObjectType = z.infer<typeof pageLayoutObjectTypeSchema>;
export type PageLayoutTab = z.infer<typeof pageLayoutTabSchema>;
export type UpdatePageLayoutTab = z.infer<typeof updatePageLayoutTabSchema>;

export interface PageLayoutTabRow {
  tab_key: string;
  title: string;
  icon: string;
  position: number;
  is_active: boolean;
  module_slug: string | null;
  required_permission: string | null;
  updated_at: Date | string;
}

export interface PageLayoutTabDTO {
  tabKey: string;
  title: string;
  icon: string;
  position: number;
  isActive: boolean;
  moduleSlug: string | null;
  requiredPermission: string | null;
  updatedAt: string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toPageLayoutTabDTO(row: PageLayoutTabRow): PageLayoutTabDTO {
  return {
    tabKey: row.tab_key,
    title: row.title,
    icon: row.icon,
    position: row.position,
    isActive: row.is_active,
    moduleSlug: row.module_slug,
    requiredPermission: row.required_permission,
    updatedAt: toIso(row.updated_at),
  };
}
