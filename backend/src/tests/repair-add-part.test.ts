import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPartSchema } from "../modules/repairs/repairs.types.js";

describe("Repair Add Part Validation & Parsing", () => {
  it("parses valid payload with canonical fields", () => {
    const input = {
      name: "Кнопка выключателя DCCN40",
      article: "DCCN40-BTN",
      quantity: 2,
      retail_price: 1500,
      cost_price: 800,
      save_to_catalog: true,
      add_to_purchase_request: false,
    };

    const parsed = createPartSchema.parse(input);
    assert.equal(parsed.name, "Кнопка выключателя DCCN40");
    assert.equal(parsed.article, "DCCN40-BTN");
    assert.equal(parsed.quantity, 2);
    assert.equal(parsed.retail_price, 1500);
    assert.equal(parsed.cost_price, 800);
    assert.equal(parsed.save_to_catalog, true);
    assert.equal(parsed.add_to_purchase_request, false);
  });

  it("handles aliases: sku -> article, price -> retail_price, and string numbers", () => {
    const input = {
      name: "  Шток ударника  ",
      sku: "STOK-01",
      quantity: "3",
      price: "2450.50",
      cost_price: "1200",
      save_to_catalog: true,
    };

    const parsed = createPartSchema.parse(input);
    assert.equal(parsed.name, "Шток ударника");
    assert.equal(parsed.article, "STOK-01");
    assert.equal(parsed.quantity, 3);
    assert.equal(parsed.retail_price, 2450.5);
    assert.equal(parsed.cost_price, 1200);
    assert.equal(parsed.save_to_catalog, true);
  });

  it("defaults article to 'Б/А' when omitted or empty", () => {
    const input = {
      name: "Пружина клапана",
      quantity: 1,
      retail_price: 350,
    };

    const parsed = createPartSchema.parse(input);
    assert.equal(parsed.name, "Пружина клапана");
    assert.equal(parsed.article, "Б/А");
    assert.equal(parsed.quantity, 1);
    assert.equal(parsed.retail_price, 350);
    assert.equal(parsed.cost_price, 0);
  });

  it("fails when name is missing or empty", () => {
    assert.throws(() => {
      createPartSchema.parse({
        name: "",
        quantity: 1,
        retail_price: 100,
      });
    });
  });

  it("fails when quantity is less than 1 or negative", () => {
    assert.throws(() => {
      createPartSchema.parse({
        name: "Деталь",
        quantity: 0,
        retail_price: 100,
      });
    });

    assert.throws(() => {
      createPartSchema.parse({
        name: "Деталь",
        quantity: -1,
        retail_price: 100,
      });
    });
  });

  it("fails when retail_price is negative", () => {
    assert.throws(() => {
      createPartSchema.parse({
        name: "Деталь",
        quantity: 1,
        retail_price: -50,
      });
    });
  });
});
