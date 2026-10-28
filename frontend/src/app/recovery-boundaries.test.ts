import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(process.cwd(), "src/app");

describe("Next recovery boundaries", () => {
  it("keeps root loading, error and global-error boundaries present", () => {
    expect(readFileSync(resolve(appRoot, "loading.tsx"), "utf8")).toContain("export default");
    expect(readFileSync(resolve(appRoot, "error.tsx"), "utf8")).toContain('"use client"');
    expect(readFileSync(resolve(appRoot, "global-error.tsx"), "utf8")).toContain("reset");
  });
});
