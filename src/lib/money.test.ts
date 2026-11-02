import { formatMinor, formatMinorCompact, formatPercent, parseMoney, toInputValue } from "@/lib/money";

describe("formatMinor", () => {
  it("formats with grouping and decimals", () => {
    expect(formatMinor(123456, 2)).toBe("1 234,56");
    expect(formatMinor(-5, 2)).toBe("−0,05");
    expect(formatMinor(1000, 0)).toBe("1 000");
    expect(formatMinor(1234, 3, "comma_dot")).toBe("1.234");
    expect(formatMinor(123456789, 2, "comma_dot")).toBe("1,234,567.89");
    expect(formatMinor(123456789, 2, "dot_comma")).toBe("1.234.567,89");
  });

  it("drops zero decimals in compact form", () => {
    expect(formatMinorCompact(150000, 2)).toBe("1 500");
    expect(formatMinorCompact(150050, 2)).toBe("1 500,50");
  });

  it("produces an editable value", () => {
    expect(toInputValue(123456, 2)).toBe("1234,56");
    expect(toInputValue(-123456, 2, "comma_dot")).toBe("-1234.56");
    expect(toInputValue(100000000, 0)).toBe("100000000");
    expect(toInputValue(1200, 2)).toBe("12");
    expect(toInputValue(1234, 3, "comma_dot")).toBe("1.234");
  });
});

describe("parseMoney", () => {
  it("parses common inputs exactly", () => {
    expect(parseMoney("12", 2)).toBe(1200);
    expect(parseMoney("12,5", 2)).toBe(1250);
    expect(parseMoney("12.05", 2)).toBe(1205);
    expect(parseMoney("1 234,56", 2)).toBe(123456);
    expect(parseMoney("1,234.56", 2)).toBe(123456);
    expect(parseMoney("1.234,56", 2)).toBe(123456);
    expect(parseMoney("1,234", 2)).toBe(123400);
    expect(parseMoney("0,1", 2)).toBe(10);
    expect(parseMoney("1500", 0)).toBe(1500);
    expect(parseMoney("1,500", 0)).toBe(1500);
    expect(parseMoney("0.001", 3)).toBe(1);
  });

  it("avoids float rounding traps", () => {
    // 0.1 + 0.2 style inputs stay exact
    expect(parseMoney("0,29", 2)).toBe(29);
    expect(parseMoney("1.15", 2)).toBe(115);
    expect(parseMoney("4.35", 2)).toBe(435);
  });

  it("rejects junk and too many decimals", () => {
    for (const bad of ["", "abc", "1,2,3.4.5", "1,2345", "12,34,5", "1e5", "-5", "12.", ",", "1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6"]) {
      expect(parseMoney(bad, 2)).toBeNull();
    }
    expect(parseMoney("12,345", 3)).toBe(12345);
    expect(parseMoney("12,345", 2)).toBe(1234500);
  });

  it("accepts negatives only when allowed", () => {
    expect(parseMoney("-50", 2, true)).toBe(-5000);
    expect(parseMoney("−1 000,5", 2, true)).toBe(-100050);
  });
});

describe("formatPercent", () => {
  it("formats basis points", () => {
    expect(formatPercent(8250)).toBe("82,5 %");
    expect(formatPercent(10000)).toBe("100 %");
    expect(formatPercent(3333)).toBe("33,3 %");
  });
});
