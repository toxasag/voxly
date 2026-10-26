import { describe, expect, it } from "vitest";
import { hashEmail, hashPhone } from "../modules/analytics/conversion-hash.utils.js";

describe("Analytics Conversion Hash Utils", () => {
  it("hashes email correctly with sha256 after trimming and lowercase", () => {
    const raw = "  Test.User@example.com ";
    const hashed = hashEmail(raw);
    expect(hashed).toBeDefined();
    expect(hashed).toHaveLength(64);
    // test.user@example.com sha256:
    // echo -n "test.user@example.com" | sha256sum
    expect(hashEmail("test.user@example.com")).toBe(hashed);
  });

  it("handles empty or invalid emails safely", () => {
    expect(hashEmail(null)).toBeNull();
    expect(hashEmail("")).toBeNull();
    expect(hashEmail("   ")).toBeNull();
  });

  it("hashes phone normalized without extra characters", () => {
    const phone1 = "+7 (999) 123-45-67";
    const phone2 = "79991234567";
    expect(hashPhone(phone1)).toBe(hashPhone(phone2));
    expect(hashPhone(phone1)).toHaveLength(64);
  });

  it("normalizes Russian 8 leading digit to 7", () => {
    const phoneWith8 = "8 (999) 123-45-67";
    const phoneWith7 = "+7 (999) 123-45-67";
    expect(hashPhone(phoneWith8)).toBe(hashPhone(phoneWith7));
  });
});
