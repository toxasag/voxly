import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  appendExcludedIdsCondition,
  buildSortOrderBy,
  bulkActionSchema,
  normalizeUuidArray,
  nullableTextExpr,
  resolveBulkTargetIds,
} from "../lib/table-query.js";
import {
  bulkCreatePurchaseRequestsSchema,
  bulkDeleteIdsSchema,
  bulkDeleteWarehouseItemsSchema,
  bulkUpdateWarehouseItemsSchema,
  warehousePaginationQuerySchema,
  warehouseTabQuerySchema,
} from "../modules/warehouse/warehouse.types.js";
import { bulkTransactionsSchema } from "../modules/finance/finance.types.js";

describe("table-query helpers", () => {
  test("nullableTextExpr converts empty strings to NULL and lowercases", () => {
    assert.equal(nullableTextExpr("i.sku"), "LOWER(NULLIF(BTRIM(i.sku), ''))");
  });

  test("buildSortOrderBy enforces whitelist and prevents SQL injection", () => {
    const orderBy = buildSortOrderBy({
      sortBy: "id; DROP TABLE users; --",
      sortDir: "asc",
      columns: {
        name: nullableTextExpr("i.name"),
        sku: { expr: nullableTextExpr("i.sku"), nullable: true },
      },
      defaultOrderBy: "i.name ASC",
      tieBreaker: "i.id DESC",
    });

    assert.equal(orderBy, "i.name ASC, i.id DESC");
  });

  test("buildSortOrderBy appends NULLS LAST for nullable columns in both ASC and DESC", () => {
    const asc = buildSortOrderBy({
      sortBy: "sku",
      sortDir: "asc",
      columns: {
        sku: { expr: nullableTextExpr("i.sku"), nullable: true },
      },
      defaultOrderBy: "i.name ASC",
      tieBreaker: "i.id DESC",
    });
    assert.equal(asc, "LOWER(NULLIF(BTRIM(i.sku), '')) ASC NULLS LAST, i.id DESC");

    const desc = buildSortOrderBy({
      sortBy: "sku",
      sortDir: "desc",
      columns: {
        sku: { expr: nullableTextExpr("i.sku"), nullable: true },
      },
      defaultOrderBy: "i.name ASC",
      tieBreaker: "i.id DESC",
    });
    assert.equal(desc, "LOWER(NULLIF(BTRIM(i.sku), '')) DESC NULLS LAST, i.id DESC");
  });

  test("buildSortOrderBy supports secondaryExpr with NULLS LAST", () => {
    const orderBy = buildSortOrderBy({
      sortBy: "name",
      sortDir: "desc",
      columns: {
        name: {
          expr: nullableTextExpr("c.first_name"),
          secondaryExpr: nullableTextExpr("c.last_name"),
          nullable: true,
        },
      },
      defaultOrderBy: "c.created_at DESC",
      tieBreaker: "c.id DESC",
    });
    assert.equal(
      orderBy,
      "LOWER(NULLIF(BTRIM(c.first_name), '')) DESC NULLS LAST, LOWER(NULLIF(BTRIM(c.last_name), '')) DESC NULLS LAST, c.id DESC",
    );
  });

  test("buildSortOrderBy avoids duplicating tieBreaker when defaultOrderBy already includes it", () => {
    const orderBy = buildSortOrderBy({
      sortBy: undefined,
      sortDir: undefined,
      columns: { name: "i.name" },
      defaultOrderBy: "i.name ASC, i.id DESC",
      tieBreaker: "i.id DESC",
    });
    assert.equal(orderBy, "i.name ASC, i.id DESC");
  });

  test("normalizeUuidArray filters non-UUID values and deduplicates", () => {
    const u1 = "11111111-1111-4111-8111-111111111111";
    const u2 = "22222222-2222-4222-8222-222222222222";
    assert.deepEqual(normalizeUuidArray([u1, "not-uuid", u2, u1, ""]), [u1, u2]);
  });

  test("appendExcludedIdsCondition appends parameterized NOT ANY condition", () => {
    const u1 = "11111111-1111-4111-8111-111111111111";
    const u2 = "22222222-2222-4222-8222-222222222222";
    const conditions: string[] = ["t.tenant_id = $1"];
    const params: Array<string | string[]> = ["tenant-id"];

    appendExcludedIdsCondition(conditions, params, "t.id", [u1, "invalid", u2, u1]);
    assert.equal(conditions.length, 2);
    assert.equal(conditions[1], "NOT (t.id = ANY($2::uuid[]))");
    assert.deepEqual(params[1], [u1, u2]);
  });

  test("resolveBulkTargetIds resolves ids mode without hitting filtered query", async () => {
    const u1 = "11111111-1111-4111-8111-111111111111";
    let filteredCalled = false;
    const result = await resolveBulkTargetIds({
      executor: {
        query: async () => [],
      },
      payload: { mode: "ids", ids: [u1, u1] },
      buildFilteredQuery: () => {
        filteredCalled = true;
        return { sql: "", params: [] };
      },
    });
    assert.equal(filteredCalled, false);
    assert.deepEqual(result, [u1]);
  });

  test("resolveBulkTargetIds passes excluded_ids into filtered query in all mode", async () => {
    const u1 = "11111111-1111-4111-8111-111111111111";
    const u2 = "22222222-2222-4222-8222-222222222222";
    let capturedSql = "";
    let capturedExcluded: string[] | undefined;

    const result = await resolveBulkTargetIds({
      executor: {
        query: async <T,>(sql: string) => {
          capturedSql = sql;
          return [{ id: u2 }] as unknown as T[];
        },
      },
      payload: {
        mode: "all",
        excluded_ids: [u1],
        filters: { search: "iphone" },
      },
      buildFilteredQuery: (excluded) => {
        capturedExcluded = excluded;
        return {
          sql: "SELECT id FROM items WHERE tenant_id = $1",
          params: ["tenant-1"],
        };
      },
    });

    assert.deepEqual(capturedExcluded, [u1]);
    assert.match(capturedSql, /SELECT id FROM items/);
    assert.deepEqual(result, [u2]);
  });
});

describe("bulk and sorting Zod schemas", () => {
  const u1 = "11111111-1111-4111-8111-111111111111";
  const u2 = "22222222-2222-4222-8222-222222222222";

  test("bulkActionSchema parses all-mode with filters and excluded_ids", () => {
    const parsed = bulkActionSchema.parse({
      mode: "all",
      excluded_ids: [u1],
      filters: { category: "Дисплеи", search: "iphone" },
    });
    assert.equal(parsed.mode, "all");
    assert.deepEqual(parsed.excluded_ids, [u1]);
    assert.deepEqual(parsed.filters, { category: "Дисплеи", search: "iphone" });
  });

  test("warehousePaginationQuerySchema supports sort_by and sort_dir", () => {
    const parsed = warehousePaginationQuerySchema.parse({
      page: "2",
      limit: "50",
      sort_by: "costPrice",
      sort_dir: "desc",
    });
    assert.equal(parsed.page, 2);
    assert.equal(parsed.limit, 50);
    assert.equal(parsed.sort_by, "costPrice");
    assert.equal(parsed.sort_dir, "desc");
  });

  test("warehouseTabQuerySchema parses pagination and sorting params", () => {
    const parsed = warehouseTabQuerySchema.parse({
      page: 3,
      limit: 100,
      sort_by: "receivedAt",
      sort_dir: "asc",
    });
    assert.equal(parsed.page, 3);
    assert.equal(parsed.limit, 100);
    assert.equal(parsed.sort_by, "receivedAt");
    assert.equal(parsed.sort_dir, "asc");
  });

  test("warehouse bulk schemas allow mode=all without ids", () => {
    assert.equal(
      bulkUpdateWarehouseItemsSchema.parse({
        mode: "all",
        excluded_ids: [u1],
        category: "АКБ",
      }).mode,
      "all",
    );
    assert.equal(
      bulkDeleteWarehouseItemsSchema.parse({
        mode: "all",
        excluded_ids: [u2],
        force: true,
      }).mode,
      "all",
    );
    assert.equal(
      bulkDeleteIdsSchema.parse({
        mode: "all",
        filters: { search: "test" },
      }).mode,
      "all",
    );
    assert.equal(
      bulkCreatePurchaseRequestsSchema.parse({
        mode: "all",
        excluded_ids: [u1],
      }).mode,
      "all",
    );
  });

  test("bulkTransactionsSchema supports both ids and all mode", () => {
    const byIds = bulkTransactionsSchema.parse({ ids: [u1] });
    assert.equal(byIds.mode, "ids");
    assert.deepEqual(byIds.ids, [u1]);

    const byAll = bulkTransactionsSchema.parse({
      mode: "all",
      excluded_ids: [u2],
      filters: { type: "expense" },
    });
    assert.equal(byAll.mode, "all");
    assert.deepEqual(byAll.excluded_ids, [u2]);
  });
});
