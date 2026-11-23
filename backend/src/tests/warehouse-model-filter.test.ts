import { test, describe } from "node:test";
import assert from "node:assert";
import { warehousePaginationQuerySchema } from "../modules/warehouse/warehouse.types.js";

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
