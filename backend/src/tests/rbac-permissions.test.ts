import { describe, expect, it } from "vitest";
import fastify from "fastify";
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, VALID_PERMISSIONS, toPermissions } from "../config/permissions.js";
import { authorizePlugin } from "../plugins/authorize.js";
import { errorHandler } from "../plugins/errorHandler.js";

describe("RBAC Permissions Configuration & Verification", () => {
  it("содержит права для сторис, чата и биллинга", () => {
    expect(VALID_PERMISSIONS.has("stories:read")).toBe(true);
    expect(VALID_PERMISSIONS.has("stories:write")).toBe(true);
    expect(VALID_PERMISSIONS.has("stories:publish")).toBe(true);
    expect(VALID_PERMISSIONS.has("chat:read")).toBe(true);
    expect(VALID_PERMISSIONS.has("chat:write")).toBe(true);
    expect(VALID_PERMISSIONS.has("billing:view")).toBe(true);
    expect(VALID_PERMISSIONS.has("billing:manage")).toBe(true);
  });

  it("владелец (owner) обладает полным набором всех прав", () => {
    for (const perm of ALL_PERMISSIONS) {
      expect(ROLE_PERMISSIONS.owner).toContain(perm);
    }
  });

  it("администратор обладает правами stories, chat и billing:view", () => {
    expect(ROLE_PERMISSIONS.admin).toContain("stories:publish");
    expect(ROLE_PERMISSIONS.admin).toContain("chat:write");
    expect(ROLE_PERMISSIONS.admin).toContain("billing:view");
    // Но не billing:manage (управление подписками только у владельца)
    expect(ROLE_PERMISSIONS.admin).not.toContain("billing:manage");
  });

  it("фильтрует неизвестные права через toPermissions", () => {
    const mixed = ["stories:read", "unknown_permission", "chat:write"];
    const filtered = toPermissions(mixed);
    expect(filtered).toEqual(["stories:read", "chat:write"]);
  });

  it("Fastify requirePermission отклоняет пользователя с 403, если право отсутствует", async () => {
    const app = fastify();
    app.setErrorHandler(errorHandler);
    await app.register(authorizePlugin);

    // Тестовый роут с защитой stories:publish
    app.post(
      "/test/stories/publish",
      {
        preHandler: [
          async (req) => {
            req.authUser = {
              id: "user-1",
              tenant_id: "tenant-1",
              email: "manager@getvoxly.ru",
              phone: "+79991112233",
              name: "Менеджер",
              role: "manager",
              platform_role: null,
              permissions: ["stories:read", "stories:write"],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            req.tenant_id = "tenant-1";
            req.permissions = new Set(["stories:read", "stories:write"]);
            req.installed_modules = [];
          },
          app.requirePermission("stories:publish"),
        ],
      },
      async () => ({ ok: true }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/test/stories/publish",
    });

    expect(response.statusCode).toBe(403);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(body.error.message).toContain("stories:publish");
  });
});
