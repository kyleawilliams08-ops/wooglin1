import { describe, it, expect } from "vitest";
import { expenseTotals, csvCell } from "./expenses";

describe("expenseTotals", () => {
  it("splits evenly and credits the payer", () => {
    const t = expenseTotals([{ paid_by: "kyle", amount: 90, shares: ["kyle", "alex", "joey"] }]);
    expect(t.get("kyle")).toEqual({ spent: 90, owe: 30, net: 60 });
    expect(t.get("alex")).toEqual({ spent: 0, owe: 30, net: -30 });
  });

  it("nets to zero across the group", () => {
    const t = expenseTotals([
      { paid_by: "kyle", amount: 70, shares: ["kyle", "lars"] },
      { paid_by: "joeg", amount: 1256.4, shares: ["a", "b", "c", "d", "e", "f", "g", "h"] },
      { paid_by: "alex", amount: 200, shares: ["kyle", "alex", "joeg", "lars"] },
    ]);
    const sum = Array.from(t.values()).reduce((n, p) => n + p.net, 0);
    expect(Math.abs(sum)).toBeLessThan(0.05);
  });

  it("a payer outside the split is owed the whole thing", () => {
    const t = expenseTotals([{ paid_by: "kyle", amount: 30, shares: ["ryan", "holt"] }]);
    expect(t.get("kyle")!.net).toBe(30);
    expect(t.get("ryan")!.net).toBe(-15);
  });

  it("ignores duplicate share ids", () => {
    const t = expenseTotals([{ paid_by: "kyle", amount: 10, shares: ["a", "a", "b"] }]);
    expect(t.get("a")!.owe).toBe(5);
  });
});

describe("csvCell", () => {
  it("quotes commas and quotes", () => {
    expect(csvCell("Kyle, Alex")).toBe('"Kyle, Alex"');
    expect(csvCell('Yeti "cooler"')).toBe('"Yeti ""cooler"""');
    expect(csvCell(12.5)).toBe("12.5");
  });
});
