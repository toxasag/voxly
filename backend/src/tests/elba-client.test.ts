import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateBillPayload,
  extractElbaErrorMessage,
  mapVatModeToElbaNds,
} from "../modules/finance/elba.client.js";

describe("Kontur.Elba client payload & error parsing", () => {
  it("sets sumsWithNDS=null and item ndsRate=null for bills without NDS (withNDS=false)", () => {
    const payload = buildCreateBillPayload({
      number: "СЧ-2026-0007",
      date: "2026-11-25",
      withNDS: false,
      sumsWithNDS: true,
      bankAccountId: "bb9fdfc1-43a5-40c9-b5d3-6d7758fa138e",
      contractorId: "11111111-1111-1111-1111-111111111111",
      warehouseItems: [
        {
          productName: "Промывка деталей в ультразвуковой ванне",
          unitName: "усл.",
          quantity: 5,
          price: 1600,
          ndsRate: "withoutNds",
        },
      ],
    });

    assert.equal(payload.withNDS, false);
    assert.equal(payload.sumsWithNDS, null);
    assert.equal(payload.number, "СЧ-2026-0007");
    const items = payload.warehouseItems as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0]?.ndsRate, null);
    assert.equal(items[0]?.productName, "Промывка деталей в ультразвуковой ванне");
    assert.equal(items[0]?.unitName, "усл.");
  });

  it("sets sumsWithNDS=true and valid ndsRate for bills with NDS (withNDS=true)", () => {
    const ndsRate = mapVatModeToElbaNds("included_20", 20);
    assert.equal(ndsRate, "nds20");

    const payload = buildCreateBillPayload({
      number: "СЧ-2026-0008",
      date: "2026-11-26",
      withNDS: true,
      sumsWithNDS: true,
      warehouseItems: [
        {
          productName: "Ремонт инструмента",
          unitName: "усл.",
          quantity: 1,
          price: 5000,
          ndsRate,
        },
      ],
    });

    assert.equal(payload.withNDS, true);
    assert.equal(payload.sumsWithNDS, true);
    const items = payload.warehouseItems as Array<Record<string, unknown>>;
    assert.equal(items[0]?.ndsRate, "nds20");
  });

  it("extracts nested Kontur.Elba ErrorResponse messages and details", () => {
    const parsed = {
      statusCode: 400,
      traceId: "abc-123",
      error: {
        code: "ValidationError",
        message: "Запрос сформирован некорректно",
        details: [
          {
            target: "sumsWithNDS",
            message: "В счёте без НДС цена за единицу товара не может включать в себя НДС",
          },
          {
            target: "warehouseItems[0].ndsRate",
            message: "Для счёта без НДС поле BillItemToCreate.NDSRate должно принимать значение null",
          },
        ],
      },
    };

    const msg = extractElbaErrorMessage(parsed, 400);
    assert.match(msg, /Запрос сформирован некорректно/);
    assert.match(msg, /sumsWithNDS: В счёте без НДС цена за единицу товара не может включать в себя НДС/);
    assert.match(msg, /warehouseItems\[0\]\.ndsRate: Для счёта без НДС/);
  });

  it("falls back cleanly when response has no structured error", () => {
    assert.equal(extractElbaErrorMessage(null, 400), "HTTP 400");
    assert.equal(extractElbaErrorMessage({ raw: "Bad Request" }, 400), "Bad Request");
  });
});
