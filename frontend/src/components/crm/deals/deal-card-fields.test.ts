import { describe, expect, it } from "vitest";

import {
  DEAL_CARD_FIELDS,
  defaultDealCardFields,
  hasDealFieldValue,
  normalizeDealCardFields,
} from "@/components/crm/deals/deal-card-fields";
import type { DealDTO } from "@/lib/api/use-deals";

function deal(overrides: Partial<DealDTO> = {}): DealDTO {
  return {
    id: "deal-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    contactId: "contact-1",
    companyId: null,
    title: "Поставка кофемашины",
    description: "",
    budget: 0,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    companyName: null,
    contactName: null,
    ownerName: null,
    ...overrides,
  };
}

describe("Поля карточки сделки", () => {
  it("реестр перечисляет все поля сделки, а не только бюджет и описание", () => {
    const ids = DEAL_CARD_FIELDS.map((field) => field.id);

    // Прежде настройка предлагала два поля и «Компактно»; теперь — весь состав.
    expect(ids).toContain("company");
    expect(ids).toContain("contact");
    expect(ids).toContain("owner");
    expect(ids).toContain("closeDate");
    expect(ids).toContain("stage");
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(ids).not.toContain("compact");
  });

  it("умолчания повторяют прежний вид карточки", () => {
    const defaults = defaultDealCardFields();

    expect(defaults.budget).toBe(true);
    expect(defaults.description).toBe(true);
    expect(defaults.closedAt).toBe(false);
  });

  it("новое поле кода получает своё умолчание, а не «скрыто»", () => {
    // В записи только два ключа: остальные добавились в код позже.
    const normalized = normalizeDealCardFields({ budget: false, description: false });

    expect(normalized.budget).toBe(false);
    expect(normalized.company).toBe(true);
    expect(normalized.closedAt).toBe(false);
  });

  it("испорченная запись не ломает набор", () => {
    expect(normalizeDealCardFields("нет")).toEqual(defaultDealCardFields());
    expect(normalizeDealCardFields(null)).toEqual(defaultDealCardFields());
  });

  it("пустые значения не считаются заполненными", () => {
    const empty = deal();

    expect(hasDealFieldValue(empty, "company")).toBe(false);
    expect(hasDealFieldValue(empty, "budget")).toBe(false);
    expect(hasDealFieldValue(empty, "description")).toBe(false);
    expect(hasDealFieldValue(empty, "closeDate")).toBe(false);
    expect(hasDealFieldValue(empty, "latestNote")).toBe(false);
  });

  it("заполненные значения показываются", () => {
    const filled = deal({
      companyName: "ООО Ромашка",
      contactName: "Иван Петров",
      budget: 150000,
      description: "Две машины",
      ownerName: "Менеджер",
      closeDate: "2026-10-01T00:00:00.000Z",
      latestNote: "Договорились о встрече",
    });

    for (const field of ["company", "contact", "budget", "description", "owner", "closeDate", "latestNote"] as const) {
      expect(hasDealFieldValue(filled, field)).toBe(true);
    }
  });
});
