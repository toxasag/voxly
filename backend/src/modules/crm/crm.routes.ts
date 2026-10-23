import type { FastifyInstance } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { contactsRoutes } from "./contacts/contacts.routes.js";
import { companiesRoutes } from "./companies/companies.routes.js";
import { dealsRoutes } from "./deals/deals.routes.js";
import { tasksRoutes } from "./tasks/tasks.routes.js";
import { notesRoutes } from "./notes/notes.routes.js";
import { recordTableLayoutsRoutes } from "./record-table-layouts/record-table-layouts.routes.js";
import { pageLayoutTabsRoutes } from "./page-layout-tabs/page-layout-tabs.routes.js";
import { timelineRoutes } from "./timeline/timeline.routes.js";
import { inboxRoutes } from "./inbox/inbox.routes.js";

/**
 * Core CRM route group, mounted at /api/v1/crm by app.ts.
 *
 * Deliberately NOT wrapped in fastify-plugin: that would break encapsulation
 * and discard the prefix, and the authenticate hook would leak to every route
 * in the application. Keeping it encapsulated scopes both the prefix and the
 * auth hooks to this group.
 */
export default async function crmRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  await app.register(contactsRoutes, { prefix: "/contacts" });
  await app.register(companiesRoutes, { prefix: "/companies" });
  await app.register(dealsRoutes, { prefix: "/deals" });
  await app.register(tasksRoutes, { prefix: "/tasks" });
  // Заметки не имеют своего права: каждый роут сверяет право по типу целевой
  // записи, поэтому группа регистрируется без requirePermission на уровне префикса.
  await app.register(notesRoutes, { prefix: "/notes" });
  await app.register(recordTableLayoutsRoutes, { prefix: "/table-layouts" });
  await app.register(pageLayoutTabsRoutes, { prefix: "/page-layouts" });
  await app.register(timelineRoutes, { prefix: "/records" });
  await app.register(inboxRoutes, { prefix: "/inbox" });
}
