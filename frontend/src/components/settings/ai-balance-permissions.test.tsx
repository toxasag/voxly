import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiBalanceCard } from "./AiBalanceCard";

let platformRole: string | null = null;
vi.mock("@/lib/auth/use-auth", () => ({ useAuth: () => ({ user: { platform_role: platformRole } }) }));
vi.mock("@/lib/api/use-ai-agents", () => ({
  formatKopecks: (value: number) => `${value / 100} ₽`,
  useTopupAiBalance: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAiBalance: () => ({ isLoading: false, isError: false, data: {
    balanceKopecks: 100000, estimatedTokensLeft: 100, spentThisMonthKopecks: 0,
    requestsThisMonth: 0, spentTotalKopecks: 0,
  } }),
}));
beforeEach(() => { platformRole = null; });
describe("AI manual credit visibility", () => {
 it("tenant owner cannot open manual credit", () => {
   render(<AiBalanceCard />);
   expect(screen.queryByRole("button", { name: /Начислить/ })).toBeNull();
   expect(screen.getByText(/Для пополнения обратитесь/)).toBeDefined();
 });
 it("platform owner sees explicitly administrative credit", () => {
   platformRole = "platform_owner";
   render(<AiBalanceCard />);
   expect(screen.getByRole("button", { name: /Начислить вручную/ })).toBeDefined();
 });
});
