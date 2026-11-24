import { describe, it, expect, vi, beforeEach } from "vitest";
import { DealsService } from "../modules/crm/deals/deals.service.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();

vi.mock("../../../db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  queryOne: (...args: unknown[]) => mockQueryOne(...args),
  runWithPlatformScope: (fn: () => Promise<unknown>) => fn(),
  withTenant: (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      query: (...args: unknown[]) => mockTxQuery(...args),
      queryOne: (...args: unknown[]) => mockTxQueryOne(...args),
      queryOneOrThrow: (...args: unknown[]) => mockTxQueryOneOrThrow(...args),
    }),
}));

vi.mock("../../../plugins/errorHandler.js", () => ({
  NotFoundError: class extends Error {},
  ValidationError: class extends Error {},
  UnprocessableEntityError: class extends Error {},
}));

vi.mock("../leads/lead-notification.queue.js", () => ({
  leadNotificationQueue: {
    checkAndTriggerNotification: vi.fn(),
  },
}));

vi.mock("../../notifications/notification.queue.js", () => ({
  notificationQueue: {},
}));

vi.mock("../../analytics/conversion-dispatcher.service.js", () => ({
  conversionDispatcher: {},
}));

vi.mock("../contacts/contact-activity.service.js", () => ({
  ContactActivityService: class {},
}));

vi.mock("../translation/message-translation.service.js", () => ({
  messageTranslationService: {},
}));

vi.mock("../chat/chat-events.js", () => ({
  chatEventBus: {},
}));

vi.mock("../../warehouse/warehouse.service.js", () => ({
  warehouseService: {
    consumeDealItemsInTx: vi.fn().mockResolvedValue([]),
  },
}));

describe("DealsService.syncDealCompletionFromRepairs", () => {
  let service: DealsService;
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const dealId = "22222222-2222-2222-2222-222222222222";
  const pipelineId = "33333333-3333-3333-3333-333333333333";
  const initialStageId = "44444444-4444-4444-4444-444444444444";
  const wonStageId = "55555555-5555-5555-5555-555555555555";
  const userId = "66666666-6666-6666-6666-666666666666";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new DealsService();
  });

  it("does not transition if deal has 2 repair orders and only 1 is completed and paid", async () => {
    // 1. Stats query: 2 total, 1 completed & paid
    mockQueryOne.mockResolvedValueOnce({
      total_orders: "2",
      completed_paid_orders: "1",
    });

    const moveStageSpy = vi.spyOn(service, "moveStage");

    await service.syncDealCompletionFromRepairs(tenantId, dealId, userId);

    expect(moveStageSpy).not.toHaveBeenCalled();
  });

  it("does not transition if deal has no repair orders", async () => {
    mockQueryOne.mockResolvedValueOnce({
      total_orders: "0",
      completed_paid_orders: "0",
    });

    const moveStageSpy = vi.spyOn(service, "moveStage");

    await service.syncDealCompletionFromRepairs(tenantId, dealId, userId);

    expect(moveStageSpy).not.toHaveBeenCalled();
  });

  it("does not transition if deal is already won", async () => {
    // All 2 orders issued & paid
    mockQueryOne.mockResolvedValueOnce({
      total_orders: "2",
      completed_paid_orders: "2",
    });

    // Deal already is_won = true
    mockQueryOne.mockResolvedValueOnce({
      id: dealId,
      pipeline_id: pipelineId,
      stage_id: wonStageId,
      created_by: userId,
      owner_id: userId,
      is_won: true,
    });

    const moveStageSpy = vi.spyOn(service, "moveStage");

    await service.syncDealCompletionFromRepairs(tenantId, dealId, userId);

    expect(moveStageSpy).not.toHaveBeenCalled();
  });

  it("automatically moves deal to won stage when ALL repair orders are issued and paid", async () => {
    // 1. Stats: 2 orders, both completed & paid
    mockQueryOne.mockResolvedValueOnce({
      total_orders: "2",
      completed_paid_orders: "2",
    });

    // 2. Deal info: not yet won
    mockQueryOne.mockResolvedValueOnce({
      id: dealId,
      pipeline_id: pipelineId,
      stage_id: initialStageId,
      created_by: userId,
      owner_id: userId,
      is_won: false,
    });

    // 3. Won stage query
    mockQueryOne.mockResolvedValueOnce({
      id: wonStageId,
    });

    const moveStageSpy = vi.spyOn(service, "moveStage").mockResolvedValueOnce(null as any);

    await service.syncDealCompletionFromRepairs(tenantId, dealId, userId);

    expect(moveStageSpy).toHaveBeenCalledWith(tenantId, dealId, wonStageId, userId);
  });
});
