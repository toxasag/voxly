import type { Permission, Role } from "../types/index.js";

// ---------------------------------------------------------------------------
// Единый справочник прав и их привязки к ролям.
//
// До этого модуля `VALID_PERMISSIONS` был объявлен дважды — в
// `plugins/authenticate.ts` и в `modules/auth/auth.service.ts`, — а карты
// «роль → права» не существовало вовсе: владелец получал полный набор списком,
// а других пользователей создать было нельзя. Приглашение сотрудника обязано
// выдавать права по роли, поэтому список вынесен сюда, чтобы не появился третий
// экземпляр, который со временем разошёлся бы с остальными.
//
// Роль и права остаются независимыми механизмами: `role` управляет
// `requireRole`, массив `permissions` — `requirePermission`. Карта ниже задаёт
// только значение по умолчанию при создании пользователя, а не выводит права из
// роли на каждом запросе.
// ---------------------------------------------------------------------------

export const ALL_PERMISSIONS: readonly Permission[] = [
  "contacts:read",
  "contacts:write",
  "contacts:delete",
  "companies:read",
  "companies:write",
  "companies:delete",
  "deals:read",
  "deals:write",
  "tasks:read",
  "tasks:write",
  "service_center:read",
  "service_center:write",
  "finance:read",
  "finance:write",
  "finance:admin",
  "ai_bots:read",
  "ai_bots:configure",
  "tenant:admin",
  "billing:manage",
  "billing:view",
  "stories:read",
  "stories:write",
  "stories:publish",
  "chat:read",
  "chat:write",
];

export const VALID_PERMISSIONS: ReadonlySet<string> = new Set<string>(ALL_PERMISSIONS);

/** Неизвестные строки из БД правами не считаются. */
export function toPermissions(raw: string[] | null): Permission[] {
  if (raw === null) return [];
  return raw.filter((value): value is Permission => VALID_PERMISSIONS.has(value));
}

/**
 * Права по умолчанию для каждой роли.
 *
 * `owner` получает всё, включая `tenant:admin` и `billing:manage`.
 * `admin` — всё, кроме биллинга: управление подпиской остаётся за владельцем,
 * иначе администратор мог бы менять состав платных модулей.
 * `manager` — CRM целиком плюс чтение сервисного центра и финансов.
 * `technician` — работа с ремонтами и задачами, без удаления и без финансов.
 * `viewer` — только чтение.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ALL_PERMISSIONS,

  admin: [
    "contacts:read",
    "contacts:write",
    "contacts:delete",
    "companies:read",
    "companies:write",
    "companies:delete",
    "deals:read",
    "deals:write",
    "tasks:read",
    "tasks:write",
    "service_center:read",
    "service_center:write",
    "finance:read",
    "finance:write",
    "finance:admin",
    "ai_bots:read",
    "ai_bots:configure",
    "tenant:admin",
    "billing:view",
    "stories:read",
    "stories:write",
    "stories:publish",
    "chat:read",
    "chat:write",
  ],

  manager: [
    "contacts:read",
    "contacts:write",
    "companies:read",
    "companies:write",
    "deals:read",
    "deals:write",
    "tasks:read",
    "tasks:write",
    "service_center:read",
    "finance:read",
    "ai_bots:read",
    "stories:read",
    "chat:read",
    "chat:write",
  ],

  technician: [
    "contacts:read",
    "companies:read",
    "deals:read",
    "tasks:read",
    "tasks:write",
    "service_center:read",
    "service_center:write",
  ],

  viewer: ["contacts:read", "companies:read", "deals:read", "tasks:read"],
};

/** Полный набор владельца — используется при регистрации арендатора. */
export const OWNER_PERMISSIONS: readonly Permission[] = ROLE_PERMISSIONS.owner;

/** Русские названия ролей для писем и интерфейса. */
export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  admin: "Администратор",
  manager: "Менеджер",
  technician: "Мастер",
  viewer: "Наблюдатель",
};

/**
 * Роли, которые можно назначить приглашаемому сотруднику.
 *
 * `owner` исключён: владелец создаётся только при регистрации арендатора, и
 * второй владелец через приглашение означал бы неограниченную передачу прав на
 * биллинг.
 */
export const ASSIGNABLE_ROLES: readonly Role[] = ["admin", "manager", "technician", "viewer"];
