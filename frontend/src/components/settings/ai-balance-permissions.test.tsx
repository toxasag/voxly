import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiBalanceCard } from "./AiBalanceCard";

let platformRole: string | null = null;
vi.mock("@/lib/auth/use-auth", () => ({ useAuth: () => ({ user: { platform_role: platformRole } }) }));
vi.mock("@/lib/api/use-ai-agents", () => ({
  formatKopecks: (value: number) => `${value / 100} ₽`,
  useTopupAiBalance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAiBalance: () => ({ isLoading: false, isError: false, data: { balanceKopecks: 100000, estimatedTokensLeft: 100, spentThisMonthKopecks: 0, requestsThisMonth: 0, spentTotalKopecks: 0 } }),
}));
vi.mock("@/lib/api/use-marketplace", () => ({ useMarketplaceBilling: () => ({ data: { billingProvider: { connected: false } } }) }));
vi.mock("@/lib/api/use-billing-checkout", () => ({ useCreateCheckout: () => ({ mutateAsync: vi.fn(), isPending: false }) }));

function renderCard() {
  return render(<QueryClientProvider client={new QueryClient()}><AiBalanceCard /></QueryClientProvider>);
}

beforeEach(() => { platformRole = null; });
describe("AI manual credit visibility", () => {
  it("tenant owner cannot open manual credit", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /Начислить/ })).toBeNull();
    expect(screen.getByText(/Онлайн-оплата временно недоступна/)).toBeDefined();
  });
  it("platform owner sees explicitly administrative credit", () => {
    platformRole = "platform_owner";
    renderCard();
    expect(screen.getByRole("button", { name: /Прямое начисление/ })).toBeDefined();
  });
});
