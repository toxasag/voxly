import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InboxPage from "./(dashboard)/inbox/page";

const renderInbox = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InboxPage />
    </QueryClientProvider>,
  );
};

describe("Inbox Omnichannel Page (Block 5.4)", () => {
  it("renders threads, active conversation and context card", () => {
    renderInbox();

    expect(screen.getByText("Входящие")).toBeDefined();
    expect(screen.getAllByText("Алексей Смирнов").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/MacBook Pro 16/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText(/Написать ответ клиенту/i)).toBeDefined();
  });

  it("filters threads by search query", () => {
    renderInbox();

    const searchInput = screen.getByPlaceholderText(/Поиск по диалогам и контактам/i);
    fireEvent.change(searchInput, { target: { value: "iPhone" } });

    expect(screen.getByText("Елена Васильева")).toBeDefined();
    expect(screen.queryByText("MacBook Pro 16")).toBeNull();
  });
});
