import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateInvoicePdfBuffer } from "../modules/finance/invoice-pdf.service.js";
import type { InvoiceDTO } from "../modules/finance/finance.types.js";

describe("generateInvoicePdfBuffer (A4 PDF счета на оплату)", () => {
  const sampleInvoice: InvoiceDTO = {
    id: "8e8a1932-5da0-489d-a0da-5088b4d9ac58",
    invoiceNumber: "СЧ-2026-0006",
    documentType: "invoice",
    status: "sent",
    issueDate: "2026-11-23T11:03:49.927Z",
    dueDate: "2026-11-26T12:00:00.000Z",
    companyId: "cfeb76e2-99c4-4d1c-ab52-d25836666462",
    companyName: "ООО \"Стартек\"",
    companyInn: "9717190908",
    companyAddress: "г. Москва",
    contactName: "Николай",
    contactPhone: "+7 901 501 30 97",
    dealId: null,
    repairOrderId: "e60aa5b9-ac96-4f83-88a3-8d476fe588a8",
    subtotal: 2000,
    vatMode: "none",
    vatRate: 0,
    vatAmount: 0,
    total: 2000,
    currency: "RUB",
    notes: "",
    paidAt: null,
    paidAccountId: null,
    issuerOrganizationId: null,
    issuerSnapshot: null,
    elbaBillId: "",
    elbaSyncedAt: null,
    elbaSyncError: "",
    lineItems: [
      {
        id: "3ed27e17-ca82-44a3-81ee-347e6fa9f76d",
        description: "Сборка/Разборка",
        quantity: 2,
        unitPrice: 1000,
        total: 2000,
        source: "repair_work",
        sourceLabel: "№0020",
      },
    ],
  };

  const sampleSettings = {
    company_name: "Индивидуальный предприниматель Сагайдак Антон Геннадьевич",
    company_inn: "505030516451",
    bank_name: "ООО \"ОЗОН Банк\" г Москва",
    bik: "044525068",
    corr_account: "30101810645374525068",
    settlement_account: "40802810700000071091",
    director_title: "Индивидуальный предприниматель",
    director_name: "Сагайдак А.Г.",
    show_qr_code: true,
    show_notice: true,
    notice_text: "Внимание! Оплата данного счёта означает согласие с условиями поставки.",
    show_basis: true,
  };

  it("генерирует валидный бинарный буфер PDF A4 с правильными ширинами глифов", () => {
    const buf = generateInvoicePdfBuffer(sampleInvoice, sampleSettings);
    assert.equal(Buffer.isBuffer(buf), true);
    assert.ok(buf.length > 10000);

    const pdfString = buf.toString("latin1");
    // Заголовок PDF
    assert.ok(pdfString.startsWith("%PDF-1.4"));
    // Размер страницы A4
    assert.ok(pdfString.includes("/MediaBox [0 0 595.28 841.89]"));
    // Наличие ToUnicode CMap
    assert.ok(pdfString.includes("/CMapName /Custom-ToUnicode def"));
    // Отсутствие моноширинного бага /W [0 65535 1000]
    assert.equal(pdfString.includes("/W [0 65535 1000]"), false);
    // Наличие динамического массива ширин глифов /W [ ... ]
    assert.match(pdfString, /\/W\s+\[\s*\d+\s+\[[\d\s]+\]/);
    // Конец файла
    assert.ok(pdfString.includes("%%EOF"));
  });
});
