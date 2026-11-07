import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DialogueFeedbackModal } from "./DialogueFeedbackModal";
import type { ChatMessageDTO } from "@/lib/api/use-crm-chat";
import { apiClient } from "@/lib/api/apiClient";

vi.mock("@/lib/api/apiClient", () => ({
  apiClient: {
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock("@/lib/api/use-ai-agents", () => ({
  useAiAgents: () => ({
    data: [
      {
        id: "agent-1",
        name: "Ассистент",
        status: "active",
      },
    ],
    isLoading: false,
  }),
}));

vi.mock("@/lib/api/use-crm-chat", () => ({
  useCrmChat: () => ({
    messagesQuery: { data: [] },
  }),
}));

const sampleMessages: ChatMessageDTO[] = [
  {
    id: "msg-1",
    dealId: "deal-100",
    channelAccountId: null,
    source: "client",
    direction: "inbound",
    senderName: "Наталья",
    content: "Какая стоимость аппарата Шарм?",
    channel: "webchat",
    attachment: null,
    attachmentType: null,
    deliveryStatus: "received",
    createdAt: "2026-11-08T01:00:00.000Z",
  },
  {
    id: "msg-2",
    dealId: "deal-100",
    channelAccountId: null,
    source: "ai",
    direction: "outbound",
    senderName: "Ассистент",
    content: "Стоимость аппарата составляет 10 000 рублей, доставим бесплатно.",
    channel: "webchat",
    attachment: null,
    attachmentType: null,
    deliveryStatus: "sent",
    createdAt: "2026-11-08T01:01:00.000Z",
  },
];

describe("DialogueFeedbackModal", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("renders conversation timeline and all messages correctly", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <DialogueFeedbackModal
          open={true}
          dealId="deal-100"
          dealTitle="Заявка от Наталья"
          contactName="Наталья"
          messages={sampleMessages}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("Обучить агента «Ассистент»")).toBeInTheDocument();
    expect(screen.getByText("Какая стоимость аппарата Шарм?")).toBeInTheDocument();
    expect(screen.getByText("Стоимость аппарата составляет 10 000 рублей, доставим бесплатно.")).toBeInTheDocument();
  });

  it("appends quotation to comment textarea without erasing existing text", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <DialogueFeedbackModal
          open={true}
          dealId="deal-100"
          dealTitle="Заявка от Наталья"
          contactName="Наталья"
          messages={sampleMessages}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    const textarea = screen.getByPlaceholderText(/Что именно агент сформулировал некорректно/i);

    // Operator enters some initial notes
    fireEvent.change(textarea, { target: { value: "Нельзя называть заниженную цену." } });
    expect(textarea).toHaveValue("Нельзя называть заниженную цену.");

    // Click on quote button for the AI message
    const quoteButtons = screen.getAllByRole("button", { name: /Цитировать/i });
    expect(quoteButtons.length).toBeGreaterThan(0);

    fireEvent.click(quoteButtons[1]); // Quote AI message

    // Textarea should contain previous text AND the new blockquote
    expect(textarea).toHaveValue(
      'Нельзя называть заниженную цену.\n\n> [Ассистент]: "Стоимость аппарата составляет 10 000 рублей, доставим бесплатно."\n\n',
    );
  });

  it("submits feedback with quotes and comment to the deals API", async () => {
    const handleClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <DialogueFeedbackModal
          open={true}
          dealId="deal-100"
          dealTitle="Заявка от Наталья"
          contactName="Наталья"
          messages={sampleMessages}
          onClose={handleClose}
        />
      </QueryClientProvider>,
    );

    const textarea = screen.getByPlaceholderText(/Что именно агент сформулировал некорректно/i);
    fireEvent.change(textarea, {
      target: { value: "Цены сообщать только ориентировочно после осмотра" },
    });

    const submitBtn = screen.getByRole("button", { name: /Отправить в обучение/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/crm/deals/deal-100/feedback",
        expect.objectContaining({
          rating: 5,
          user_comment: expect.stringContaining("Цены сообщать только ориентировочно после осмотра"),
        }),
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });
});
