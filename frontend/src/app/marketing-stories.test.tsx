import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import MarketingStoriesPage from "./(dashboard)/marketing/stories/page";

describe("Marketing Stories Page (Block 2.3)", () => {
  it("renders composer, mobile preview and stories log", () => {
    render(<MarketingStoriesPage />);

    expect(screen.getByText("Истории (Stories)")).toBeDefined();
    expect(screen.getByText("Предпросмотр (9:16)")).toBeDefined();
    expect(screen.getByText("Журнал историй")).toBeDefined();
    expect(screen.getByPlaceholderText(/Введите текст истории/i)).toBeDefined();
  });

  it("updates live preview when user types text", () => {
    render(<MarketingStoriesPage />);

    const textarea = screen.getByPlaceholderText(/Введите текст истории/i);
    fireEvent.change(textarea, { target: { value: "Тестовая акция 50%" } });

    expect(screen.getAllByText("Тестовая акция 50%").length).toBeGreaterThanOrEqual(1);
  });
});
