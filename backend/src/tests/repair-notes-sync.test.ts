import { describe, it, expect, vi, beforeEach } from "vitest";
import { RepairsService } from "../modules/repairs/repairs.service.js";

const mockQuery = vi.fn();
const mockQueryOne = vi.fn();
const mockTxQuery = vi.fn();
const mockTxQueryOne = vi.fn();
const mockTxQueryOneOrThrow = vi.fn();

vi.mock("../db/client.js", () => ({
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

vi.mock("../tenant/tenant-defaults.js", () => ({
  ensureTenantDefaults: vi.fn().mockResolvedValue({}),
}));

describe("RepairsService Notes & Dual-Entity Activity Sync", () => {
  let service: RepairsService;
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const author = { id: "22222222-2222-2222-2222-222222222222", name: "Сервисный Инженер" };
  const orderId = "33333333-3333-3333-3333-333333333333";
  const dealId = "44444444-4444-4444-4444-444444444444";

  beforeEach(() => {
    vi.clearAllMocks();
    service = new RepairsService();
  });

  it("creates a note and syncs it to the linked CRM deal (Dual-Entity Sync)", async () => {
    // 1. tx.queryOne for repair order
    mockTxQueryOne.mockResolvedValueOnce({
      id: orderId,
      deal_id: dealId,
      ticket_number: "0005",
    });

    // 2. tx.queryOneOrThrow for repair_notes insert
    const noteId = "55555555-5555-5555-5555-555555555555";
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: noteId,
      repair_order_id: orderId,
      author_id: author.id,
      author_name: author.name,
      kind: "note",
      content: "Согласована замена дисплейного модуля. Клиент подтвердил.",
      from_status: null,
      to_status: null,
      created_at: new Date("2026-11-09T14:30:00Z"),
    });

    // 3. tx.queryOne for user check in users table
    mockTxQueryOne.mockResolvedValueOnce({ id: author.id });

    // 4. tx.queryOne for notes insert
    const dealNoteId = "66666666-6666-6666-6666-666666666666";
    mockTxQueryOne.mockResolvedValueOnce({ id: dealNoteId });

    // 5. tx.query for note_targets insert
    mockTxQuery.mockResolvedValueOnce({});

    const result = await service.addNote(tenantId, orderId, author, {
      content: "Согласована замена дисплейного модуля. Клиент подтвердил.",
    });

    // Verify repair note response matches criteria: id, content, createdAt, userId, repairId, dealId
    expect(result.id).toBe(noteId);
    expect(result.content).toBe("Согласована замена дисплейного модуля. Клиент подтвердил.");
    expect(result.userId).toBe(author.id);
    expect(result.repairId).toBe(orderId);
    expect(result.dealId).toBe(dealId);
    expect(result.authorName).toBe(author.name);
    expect(result.createdAt).toBe("2026-11-09T14:30:00.000Z");

    // Verify dual-entity insertion into notes and note_targets
    expect(mockTxQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO notes"),
      [
        tenantId,
        "Наряд №0005",
        "Согласована замена дисплейного модуля. Клиент подтвердил.",
        dealId,
        orderId,
        author.id,
      ],
    );

    expect(mockTxQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO note_targets"),
      [tenantId, dealNoteId, dealId],
    );
  });

  it("creates a repair note without CRM sync if no deal is linked", async () => {
    // 1. tx.queryOne for repair order with deal_id = null
    mockTxQueryOne.mockResolvedValueOnce({
      id: orderId,
      deal_id: null,
      ticket_number: "0006",
    });

    // 2. tx.queryOneOrThrow for repair_notes insert
    const noteId = "77777777-7777-7777-7777-777777777777";
    mockTxQueryOneOrThrow.mockResolvedValueOnce({
      id: noteId,
      repair_order_id: orderId,
      author_id: author.id,
      author_name: author.name,
      kind: "note",
      content: "Автономная заметка без сделки",
      from_status: null,
      to_status: null,
      created_at: new Date("2026-11-09T14:45:00Z"),
    });

    const result = await service.addNote(tenantId, orderId, author, {
      content: "Автономная заметка без сделки",
    });

    expect(result.id).toBe(noteId);
    expect(result.content).toBe("Автономная заметка без сделки");
    expect(result.repairId).toBe(orderId);
    expect(result.dealId).toBeNull();

    // Verify no insert into notes was made
    expect(mockTxQueryOne).toHaveBeenCalledTimes(1); // only order lookup
  });

  it("lists notes with repair_order deal_id joined", async () => {
    const noteId = "88888888-8888-8888-8888-888888888888";
    mockQuery.mockResolvedValueOnce([
      {
        id: noteId,
        repair_order_id: orderId,
        author_id: author.id,
        author_name: author.name,
        kind: "note",
        content: "Тестовая заметка",
        from_status: null,
        to_status: null,
        created_at: new Date("2026-11-09T15:00:00Z"),
        deal_id: dealId,
      },
    ]);

    const list = await service.listNotes(tenantId, orderId);

    expect(list).toHaveLength(1);
    const first = list[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("first is undefined");
    expect(first.id).toBe(noteId);
    expect(first.dealId).toBe(dealId);
    expect(first.repairId).toBe(orderId);
    expect(first.userId).toBe(author.id);
  });
});
