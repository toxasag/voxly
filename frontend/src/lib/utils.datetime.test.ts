import { describe, it, expect } from "vitest";
import {
  localDateInputToIso,
  localDateTimeToIso,
  toLocalDateKey,
  toLocalDateTimeInput,
} from "./utils";

describe("local date/time conversion helpers (no UTC double-shift)", () => {
  it("round-trips a Date through toLocalDateTimeInput -> localDateTimeToIso without timezone drift", () => {
    const now = new Date(2026, 10, 26, 16, 20, 0, 0);
    const inputVal = toLocalDateTimeInput(now);
    expect(inputVal).toBe("2026-11-26T16:20");

    const backIso = localDateTimeToIso(inputVal);
    expect(backIso).toBeDefined();
    expect(new Date(backIso as string).getTime()).toBe(now.getTime());
  });

  it("localDateInputToIso preserves exact current timestamp when selected date is today", () => {
    const refNow = new Date(2026, 10, 26, 16, 22, 42, 0);
    const todayKey = toLocalDateKey(refNow);
    expect(todayKey).toBe("2026-11-26");

    const iso = localDateInputToIso(todayKey, refNow);
    expect(iso).toBe(refNow.toISOString());
  });

  it("localDateInputToIso uses local noon (12:00) for non-today dates instead of UTC midnight", () => {
    const refNow = new Date(2026, 10, 26, 16, 22, 42, 0);
    const iso = localDateInputToIso("2026-11-20", refNow);
    expect(iso).toBeDefined();

    const parsed = new Date(iso as string);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10);
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getHours()).toBe(12);
    expect(parsed.getMinutes()).toBe(0);
  });
});
