import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ServiceItem } from "./ServiceItem";
import type { ServiceItemDTO } from "@/lib/api/use-services";

const MOCK_SERVICE: ServiceItemDTO = {
  id: "srv-123",
  name: "Замена термопасты и чистка",
  description: "Полная разборка системы охлаждения, удаление пыли, нанесение термопасты MX-4",
  price: 1500,
  defaultPrice: 1500,
  unit: "усл",
  durationMinutes: 45,
  createdAt: "2026-11-23T10:00:00Z",
};

describe("ServiceItem Component", () => {
  it("renders service details and edit button correctly", () => {
    const handleEdit = vi.fn();
    const handleDelete = vi.fn();

    render(
      <ServiceItem
        service={MOCK_SERVICE}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />,
    );

    // Verify service name and description
    expect(screen.getByText("Замена термопасты и чистка")).toBeDefined();
    expect(
      screen.getByText(
        "Полная разборка системы охлаждения, удаление пыли, нанесение термопасты MX-4",
      ),
    ).toBeDefined();

    // Verify edit button exists with accessible label
    const editBtn = screen.getByRole("button", { name: "Редактировать услугу" });
    expect(editBtn).toBeDefined();
    expect(editBtn.getAttribute("title")).toBe("Редактировать услугу");

    // Verify button text
    expect(screen.getByText("Редактировать")).toBeDefined();
  });

  it("calls onEdit with service object when edit button is clicked", () => {
    const handleEdit = vi.fn();

    render(<ServiceItem service={MOCK_SERVICE} onEdit={handleEdit} />);

    const editBtn = screen.getByRole("button", { name: "Редактировать услугу" });
    fireEvent.click(editBtn);

    expect(handleEdit).toHaveBeenCalledTimes(1);
    expect(handleEdit).toHaveBeenCalledWith(MOCK_SERVICE);
  });

  it("renders select button when onSelect prop is provided", () => {
    const handleEdit = vi.fn();
    const handleSelect = vi.fn();

    render(
      <ServiceItem
        service={MOCK_SERVICE}
        onEdit={handleEdit}
        onSelect={handleSelect}
      />,
    );

    const selectBtn = screen.getByRole("button", {
      name: `Выбрать услугу ${MOCK_SERVICE.name}`,
    });
    expect(selectBtn).toBeDefined();

    fireEvent.click(selectBtn);
    expect(handleSelect).toHaveBeenCalledWith(MOCK_SERVICE);
  });
});
