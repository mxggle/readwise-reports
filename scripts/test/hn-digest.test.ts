import { describe, expect, it } from "vitest";
import { computeAiStatus } from "../../skills/hn/lib/digest.js";

describe("hn digest: computeAiStatus", () => {
  it("ok when no batches failed", () => {
    expect(computeAiStatus(0, 5)).toBe("ok");
  });

  it("ok when there were no batches at all", () => {
    expect(computeAiStatus(0, 0)).toBe("ok");
  });

  it("partial when some but not all batches failed", () => {
    expect(computeAiStatus(2, 5)).toBe("partial");
    expect(computeAiStatus(4, 5)).toBe("partial");
  });

  it("failed when every batch failed", () => {
    expect(computeAiStatus(5, 5)).toBe("failed");
  });
});
