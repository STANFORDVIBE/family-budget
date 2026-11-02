import { formatDate, monthRange, periodFor, periodLabel, shiftMonth, shiftPeriod } from "@/lib/dates";

describe("dates", () => {
  it("computes periods around an anchor", () => {
    const anchor = new Date(2025, 2, 12); // Wednesday, 12 March 2025
    expect(periodFor("week", anchor)).toEqual({ kind: "week", from: "2025-03-10", to: "2025-03-16" });
    expect(periodFor("month", anchor)).toEqual({ kind: "month", from: "2025-03-01", to: "2025-03-31" });
    expect(periodFor("quarter", anchor)).toEqual({ kind: "quarter", from: "2025-01-01", to: "2025-03-31" });
    expect(periodFor("year", anchor)).toEqual({ kind: "year", from: "2025-01-01", to: "2025-12-31" });
  });

  it("shifts periods and months", () => {
    expect(shiftPeriod(periodFor("month", new Date(2025, 0, 15)), -1)).toEqual({
      kind: "month",
      from: "2024-12-01",
      to: "2024-12-31",
    });
    expect(shiftPeriod({ kind: "custom", from: "2025-03-01", to: "2025-03-10" }, 1)).toEqual({
      kind: "custom",
      from: "2025-03-11",
      to: "2025-03-20",
    });
    expect(shiftMonth("2025-01", -1)).toBe("2024-12");
    expect(monthRange("2024-02")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
  });

  it("formats dates and labels", () => {
    expect(formatDate("2025-03-08")).toBe("08.03.2025");
    expect(formatDate("2025-03-08", "MM/dd/yyyy")).toBe("03/08/2025");
    expect(periodLabel(periodFor("quarter", new Date(2025, 7, 1)), "dd.MM.yyyy")).toBe("3 квартал 2025");
  });
});
