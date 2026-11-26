import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorksBatchSchema } from "../modules/repairs/repairs.types.js";

const MASTER_UUID = "11111111-1111-4111-8111-111111111111";

describe("Repair Works Batch Schema Validation", () => {
  it("accepts multiple valid work items and applies default quantity", () => {
    const parsed = createWorksBatchSchema.parse({
      items: [
        {
          description: "Очистка и смазка деталей",
          master_id: MASTER_UUID,
          master_name: "Даниил Доносов",
          unit_price: 1000,
          cost: 1000,
        },
        {
          description: "Пайка коннектора питания",
          master_id: MASTER_UUID,
          master_name: "Даниил Доносов",
          quantity: 2,
          unit_price: 800,
          cost: 1600,
        },
      ],
    });

    assert.equal(parsed.items.length, 2);
    const [first, second] = parsed.items;
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.quantity, 1);
    assert.equal(first.unit_price, 1000);
    assert.equal(second.quantity, 2);
    assert.equal(second.cost, 1600);
  });

  it("rejects empty items array", () => {
    assert.throws(() => {
      createWorksBatchSchema.parse({ items: [] });
    });
  });

  it("rejects more than 100 items in one batch", () => {
    const items = Array.from({ length: 101 }, (_, idx) => ({
      description: `Услуга ${idx + 1}`,
      master_id: MASTER_UUID,
      master_name: "Даниил Доносов",
      quantity: 1,
      unit_price: 500,
      cost: 500,
    }));

    assert.throws(() => {
      createWorksBatchSchema.parse({ items });
    });
  });

  it("rejects invalid item fields (non-UUID master_id, negative price, zero qty)", () => {
    assert.throws(() => {
      createWorksBatchSchema.parse({
        items: [
          {
            description: "Диагностика",
            master_id: "not-a-uuid",
            master_name: "Мастер",
            quantity: 1,
            unit_price: 500,
          },
        ],
      });
    });

    assert.throws(() => {
      createWorksBatchSchema.parse({
        items: [
          {
            description: "Диагностика",
            master_id: MASTER_UUID,
            master_name: "Мастер",
            quantity: 0,
            unit_price: 500,
          },
        ],
      });
    });

    assert.throws(() => {
      createWorksBatchSchema.parse({
        items: [
          {
            description: "Диагностика",
            master_id: MASTER_UUID,
            master_name: "Мастер",
            quantity: 1,
            unit_price: -100,
          },
        ],
      });
    });
  });
});
