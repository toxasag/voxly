import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { NotificationDropdown } from "./NotificationDropdown";
import type { AppNotification } from "@/types";

const mockPush = vi.fn();
const mockMarkAllRead = vi.fn();
const mockMarkOneRead = vi.fn();
const mockMarkEntityRead = vi.fn();

let mockNotifications: AppNotification[] = [];
let mockUnreadCount = 0;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/lib/notifications/use-inapp-notifications", () => ({
  useInAppNotifications: () => ({
    notifications: mockNotifications,
    unreadCount: mockUnreadCount,
    isLoading: false,
    refetch: vi.fn(),
    markAllRead: mockMarkAllRead,
    markOneRead: mockMarkOneRead,
    markEntityRead: mockMarkEntityRead,
  }),
}));

vi.mock("@/lib/notifications/use-web-push", () => ({
  useWebPush: () => ({
    isSupported: false,
    isSubscribed: false,
    subscribe: vi.fn(),
    isLoading: false,
  }),
}));

describe("NotificationDropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotifications = [];
    mockUnreadCount = 0;
  });

  it("hides read notifications and shows only unread ones", () => {
    mockNotifications = [
      {
        id: "n-1",
        category: "message",
        entity_type: "deal",
        entity_id: "deal-1",
        title: "Новое сообщение в MAX",
        description: "Михаил: «Отправил»",
        created_at: new Date().toISOString(),
        read: false,
      },
      {
        id: "n-2",
        category: "message",
        entity_type: "deal",
        entity_id: "deal-2",
        title: "Прочитанное уведомление",
        description: "Уже прочитано",
        created_at: new Date().toISOString(),
        read: true,
      },
    ];
    mockUnreadCount = 1;

    render(<NotificationDropdown />);

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));

    expect(screen.getByText("Новое сообщение в MAX")).toBeDefined();
    expect(screen.queryByText("Прочитанное уведомление")).toBeNull();
  });

  it("marks all notifications for the entity read when clicking a deal notification", () => {
    mockNotifications = [
      {
        id: "n-1",
        category: "message",
        entity_type: "deal",
        entity_id: "deal-42",
        title: "Новое сообщение в MAX",
        description: "Михаил: «Отправил»",
        data: { url: "/crm/deals/deal-42" },
        created_at: new Date().toISOString(),
        read: false,
      },
    ];
    mockUnreadCount = 1;

    render(<NotificationDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByText("Новое сообщение в MAX"));

    expect(mockMarkEntityRead).toHaveBeenCalledWith({
      entity_type: "deal",
      entity_id: "deal-42",
    });
    expect(mockPush).toHaveBeenCalledWith("/crm/deals/deal-42");
  });

  it("shows empty state when all notifications are read", () => {
    mockNotifications = [
      {
        id: "n-read",
        category: "lead",
        entity_type: "deal",
        entity_id: "deal-1",
        title: "Старая заявка",
        description: "Уже просмотрено",
        created_at: new Date().toISOString(),
        read: true,
      },
    ];
    mockUnreadCount = 0;

    render(<NotificationDropdown />);
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));

    expect(screen.getByText("Нет непрочитанных уведомлений")).toBeDefined();
    expect(screen.queryByText("Старая заявка")).toBeNull();
  });
});
