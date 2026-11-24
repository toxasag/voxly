import { test, describe } from "node:test";
import assert from "node:assert";
import {
  warehousePaginationQuerySchema,
  bulkUpdateWarehouseItemsSchema,
} from "../modules/warehouse/warehouse.types.js";

describe("warehousePaginationQuerySchema model_ids filter parsing", () => {
  const uuid1 = "41015644-259f-4674-bdfc-6c7926a38589";
  const uuid2 = "8dd115d4-e2eb-46a8-bc2b-e352ad8b7769";

  test("parses single model_ids string", () => {
    const res = warehousePaginationQuerySchema.parse({ model_ids: uuid1 });
    assert.deepStrictEqual(res.model_ids, [uuid1]);
  });

  test("parses comma-separated model_ids string", () => {
    const res = warehousePaginationQuerySchema.parse({ model_ids: `${uuid1},${uuid2}` });
    assert.deepStrictEqual(res.model_ids, [uuid1, uuid2]);
  });

  test("parses array of model_ids", () => {
    const res = warehousePaginationQuerySchema.parse({ model_ids: [uuid1, uuid2] });
    assert.deepStrictEqual(res.model_ids, [uuid1, uuid2]);
  });

  test("parses camelCase modelIds", () => {
    const res = warehousePaginationQuerySchema.parse({ modelIds: `${uuid1}, ${uuid2}` });
    assert.deepStrictEqual(res.modelIds, [uuid1, uuid2]);
  });

  test("leaves model_ids undefined when omitted", () => {
    const res = warehousePaginationQuerySchema.parse({});
    assert.strictEqual(res.model_ids, undefined);
    assert.strictEqual(res.modelIds, undefined);
  });

  test("leaves model_ids undefined when empty string", () => {
    const res = warehousePaginationQuerySchema.parse({ model_ids: "" });
    assert.strictEqual(res.model_ids, undefined);
  });

  test("fails on invalid non-uuid string", () => {
    assert.throws(() => {
      warehousePaginationQuerySchema.parse({ model_ids: "not-a-uuid" });
    });
  });
});

describe("bulkUpdateWarehouseItemsSchema models validation", () => {
  const uuid1 = "41015644-259f-4674-bdfc-6c7926a38589";
  const uuid2 = "8dd115d4-e2eb-46a8-bc2b-e352ad8b7769";

  test("parses valid bulk update with models array", () => {
    const res = bulkUpdateWarehouseItemsSchema.parse({
      ids: [uuid1],
      models: ["iPhone 13", "iPhone 14"],
      models_mode: "replace",
    });
    assert.deepStrictEqual(res.models, ["iPhone 13", "iPhone 14"]);
    assert.strictEqual(res.models_mode, "replace");
  });

  test("parses bulk update with models_mode add", () => {
    const res = bulkUpdateWarehouseItemsSchema.parse({
      ids: [uuid1, uuid2],
      models: ["Galaxy S22"],
      models_mode: "add",
    });
    assert.deepStrictEqual(res.models, ["Galaxy S22"]);
    assert.strictEqual(res.models_mode, "add");
  });

  test("parses empty models with replace mode to clear models", () => {
    const res = bulkUpdateWarehouseItemsSchema.parse({
      ids: [uuid1],
      models: [],
      models_mode: "replace",
    });
    assert.deepStrictEqual(res.models, []);
    assert.strictEqual(res.models_mode, "replace");
  });
});
