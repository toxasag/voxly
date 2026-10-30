import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import InboxPage from "./(dashboard)/inbox/page";

vi.mock("@/lib/api/use-inbox", () => ({
  useInboxThreads: ({ search }: { search?: string } = {}) => ({
    data: search === "iPhone"
      ? [{ dealId: "2", contactName: "Елена Васильева", dealTitle: "iPhone 15", channel: "telegram", lastMessage: "Вопрос", lastMessageAt: new Date().toISOString(), lastDirection: "inbound", unreadCount: 1 }]
      : [{ dealId: "1", contactName: "Алексей Смирнов", dealTitle: "MacBook Pro 16", channel: "telegram", lastMessage: "Здравствуйте", lastMessageAt: new Date().toISOString(), lastDirection: "inbound", unreadCount: 1 }],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock("@/components/crm/shared/CrmChatView", () => ({
  CrmChatView: () => <textarea placeholder="Написать ответ клиенту" />,
}));

describe("Inbox Omnichannel Page (Block 5.4)", () => {
  it("renders threads, active conversation and context card", () => {
    render(<InboxPage />);
    expect(screen.getByText("Входящие")).toBeDefined();
    expect(screen.getAllByText("Алексей Смирнов").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/MacBook Pro 16/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByPlaceholderText(/Написать ответ клиенту/i)).toBeDefined();
  });

  it("filters threads by search query", () => {
    render(<InboxPage />);
    fireEvent.change(screen.getByPlaceholderText(/Поиск по диалогам и контактам/i), { target: { value: "iPhone" } });
    expect(screen.getAllByText("Елена Васильева").length).toBeGreaterThan(0);
    expect(screen.queryByText("MacBook Pro 16")).toBeNull();
  });
});
