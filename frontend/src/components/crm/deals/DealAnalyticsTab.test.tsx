import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DealAnalyticsTab } from "@/components/crm/deals/DealAnalyticsTab";
import type { DealDTO } from "@/lib/api/use-deals";

vi.mock("@/lib/api/use-contacts", () => ({
  useContact: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
}));

function createDealWithGeo(geoData?: Record<string, unknown>): DealDTO {
  return {
    id: "deal-geo-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    contactId: null,
    companyId: null,
    companyName: null,
    contactName: null,
    ownerName: null,
    title: "Тестовая сделка",
    description: "",
    budget: 0,
    currency: "RUB",
    customFields: geoData ? { geo: geoData } : {},
    sourceMetadata: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("DealAnalyticsTab Geolocation View", () => {
  it("renders textual geolocation without any iframe or map embed", () => {
    const deal = createDealWithGeo({
      ip: "109.95.217.174",
      isp: "Limited Liability Company Sviaz Industriya",
      city: "Москва",
      region: "Москва",
      address: "Москва, Россия",
      country: "Россия",
      countryCode: "RU",
      latitude: 55.7558,
      longitude: 37.6173,
      timezone: "Europe/Moscow",
      provider: "ip-api",
      sourceType: "ip",
    });

    const { container } = render(<DealAnalyticsTab deal={deal} />);

    // Проверяем, что никаких iframe нет в DOM
    const iframes = container.querySelectorAll("iframe");
    expect(iframes.length).toBe(0);

    // Проверяем текстовые данные геолокации
    expect(screen.getByText("Геолокация и адрес посетителя")).toBeDefined();
    expect(screen.getByText("Москва, Россия (RU)")).toBeDefined();
    expect(screen.getByText("Москва, Россия")).toBeDefined();
    expect(screen.getByText("Широта: 55.75580, Долгота: 37.61730")).toBeDefined();
    expect(screen.getByText("Europe/Moscow")).toBeDefined();

    // Проверяем внешние ссылки
    const yandexLink = container.querySelector<HTMLAnchorElement>('a[href*="yandex.ru/maps"]');
    expect(yandexLink).not.toBeNull();
    expect(yandexLink?.getAttribute("target")).toBe("_blank");

    const googleLink = container.querySelector<HTMLAnchorElement>('a[href*="google.com/maps"]');
    expect(googleLink).not.toBeNull();
    expect(googleLink?.getAttribute("target")).toBe("_blank");

    const osmLink = container.querySelector<HTMLAnchorElement>('a[href*="openstreetmap.org"]');
    expect(osmLink).not.toBeNull();
    expect(osmLink?.getAttribute("target")).toBe("_blank");
  });

  it("renders clean empty state when geolocation data is absent", () => {
    const deal = createDealWithGeo(undefined);
    deal.customFields = {
      page_url: "https://example.com/test",
    };

    render(<DealAnalyticsTab deal={deal} />);

    expect(screen.getByText("Геолокация и адрес посетителя")).toBeDefined();
    expect(screen.getByText("Нет данных")).toBeDefined();
    expect(
      screen.getByText("Геолокационные данные не зафиксированы (посетитель не передал координаты или IP скрыт)."),
    ).toBeDefined();
  });
});
