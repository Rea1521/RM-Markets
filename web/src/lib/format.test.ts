import { describe, expect, it } from "vitest";
import { baseAsset, decimalsFor, fmtPct, fmtPrice, fmtSignedUsd, fmtUsd } from "./format";

describe("format", () => {
  it("prices", () => {
    expect(fmtPrice(67284.45)).toBe("67,284.45");
    expect(fmtPrice(0.55301)).toBe("0.55301");
    expect(decimalsFor(1.08)).toBe(4);
    expect(fmtPrice(null)).toBe("—");
  });
  it("money and percent", () => {
    expect(fmtUsd(-1234.5)).toBe("-$1,234.50");
    expect(fmtSignedUsd(4250.75)).toBe("+$4,250.75");
    expect(fmtPct(4.25)).toBe("+4.25%");
    expect(fmtPct(-0.85)).toBe("-0.85%");
  });
  it("base asset", () => {
    expect(baseAsset("BTC/USDT")).toBe("BTC");
    expect(baseAsset("AAPL")).toBe("AAPL");
  });
});
