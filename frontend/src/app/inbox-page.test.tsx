import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import InboxPage from "./(dashboard)/inbox/page";

describe("Inbox Omnichannel Page (Block 5.4)", () => {
  it("renders threads, active conversation and context card", () => {
    render(<InboxPage />);

    expect(screen.getByText("Входящие (Inbox)")).toBeDefined();
    expect(screen.getAllByText("Алексей Смирнов").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/MacBook Pro 16/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText(/Написать ответ клиенту/i)).toBeDefined();
  });

  it("filters threads by search query", () => {
    render(<InboxPage />);

    const searchInput = screen.getByPlaceholderText(/Поиск диалогов/i);
    fireEvent.change(searchInput, { target: { value: "iPhone" } });

    expect(screen.getByText("Елена Васильева")).toBeDefined();
    expect(screen.queryByText("MacBook Pro 16")).toBeNull();
  });
});
