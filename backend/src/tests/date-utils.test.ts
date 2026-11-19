import { test, describe } from "node:test";
import assert from "node:assert";
import { excelSerialToISO, parseDateField } from "../lib/date.utils.js";

describe("date.utils unit tests", () => {
  test("excelSerialToISO converts 33271 to 1991-01-15", () => {
    assert.strictEqual(excelSerialToISO(33271), "1991-01-15");
  });

  test("excelSerialToISO converts other serials accurately", () => {
    // 32762 -> 1989-09-11
    assert.strictEqual(excelSerialToISO(32762), "1989-09-11");
    // 35593 -> 1997-06-12
    assert.strictEqual(excelSerialToISO(35593), "1997-06-12");
  });

  test("parseDateField parses number serial", () => {
    assert.strictEqual(parseDateField(33271), "1991-01-15");
    assert.strictEqual(parseDateField(32762), "1989-09-11");
  });

  test("parseDateField parses string serial", () => {
    assert.strictEqual(parseDateField("33271"), "1991-01-15");
    assert.strictEqual(parseDateField("32762"), "1989-09-11");
  });

  test("parseDateField parses Russian date formats", () => {
    assert.strictEqual(parseDateField("15.01.1991"), "1991-01-15");
    assert.strictEqual(parseDateField("1.2.1995"), "1995-02-01");
    assert.strictEqual(parseDateField("25/12/2000"), "2000-12-25");
  });

  test("parseDateField parses ISO date formats", () => {
    assert.strictEqual(parseDateField("1991-01-15"), "1991-01-15");
    assert.strictEqual(parseDateField("2026-11-18"), "2026-11-18");
  });

  test("parseDateField returns null for invalid or empty inputs", () => {
    assert.strictEqual(parseDateField(null), null);
    assert.strictEqual(parseDateField(undefined), null);
    assert.strictEqual(parseDateField(""), null);
    assert.strictEqual(parseDateField("   "), null);
    assert.strictEqual(parseDateField("not-a-date"), null);
  });
});
