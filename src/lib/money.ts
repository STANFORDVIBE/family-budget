// Money in the UI is integer minor units (cents). Conversion to and from text is done with
// string operations only: no float ever touches an amount.

import type { Settings } from "@/lib/types";

export type NumberFormat = Settings["numberFormat"];

const SEPARATORS: Record<NumberFormat, { group: string; decimal: string }> = {
  // no-break space keeps "1 234,56" on one line
  space_comma: { group: "\u00a0", decimal: "," },
  comma_dot: { group: ",", decimal: "." },
  dot_comma: { group: ".", decimal: "," },
};

/** 123456 (2 decimals) → "1 234,56". */
export function formatMinor(amount: number, decimals: number, format: NumberFormat = "space_comma"): string {
  const { group, decimal } = SEPARATORS[format];
  const negative = amount < 0;
  const digits = Math.abs(Math.trunc(amount)).toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return `${negative ? "\u2212" : ""}${grouped}${fracPart ? decimal + fracPart : ""}`;
}

/** Same as formatMinor but drops ",00" for whole amounts (compact displays, charts). */
export function formatMinorCompact(amount: number, decimals: number, format: NumberFormat = "space_comma"): string {
  const full = formatMinor(amount, decimals, format);
  const { decimal } = SEPARATORS[format];
  return decimals > 0 && full.endsWith(decimal + "0".repeat(decimals)) ? full.slice(0, -(decimals + 1)) : full;
}

/** Value for an input field: plain digits with the format's decimal separator, no grouping. */
export function toInputValue(amount: number, decimals: number, format: NumberFormat = "space_comma"): string {
  const { decimal } = SEPARATORS[format];
  const digits = Math.abs(Math.trunc(amount)).toString().padStart(decimals + 1, "0");
  const intPart = digits.slice(0, digits.length - decimals);
  const fracPart = decimals > 0 ? digits.slice(digits.length - decimals) : "";
  const showFrac = fracPart !== "" && /[1-9]/.test(fracPart);
  return `${amount < 0 ? "-" : ""}${intPart}${showFrac ? decimal + fracPart : ""}`;
}

/**
 * Parses user input into minor units. Accepts "1234", "1 234,5", "1,234.56", "1.234,56", "-50".
 * The last "," or "." is the decimal separator when followed by at most `decimals` digits.
 * Returns null for anything that is not a clean amount.
 */
export function parseMoney(text: string, decimals: number, allowNegative = false): number | null {
  let s = text.trim().replace(/[\s\u00a0\u202f']/g, "").replace("\u2212", "-");
  let negative = false;
  if (s.startsWith("-")) {
    if (!allowNegative) return null;
    negative = true;
    s = s.slice(1);
  }
  if (!s || !/^[\d.,]+$/.test(s)) return null;

  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  let intPart = s;
  let fracPart = "";
  if (lastSep >= 0) {
    const after = s.slice(lastSep + 1);
    const sepChar = s[lastSep] ?? ",";
    const sepCount = s.split(sepChar).length - 1;
    // "1,234" with 3 digits after a single comma in a 2-decimal currency is a thousands group
    const isDecimal = sepCount === 1 && after.length <= decimals && after.length > 0;
    if (isDecimal) {
      intPart = s.slice(0, lastSep);
      fracPart = after;
    } else if (after.length === 0) {
      return null;
    }
  }
  // Thousands groups must be real groups: "1,234" yes, "1,2345" or "12,34,5" no.
  const groups = intPart.split(/[.,]/);
  if (groups.length > 1 && (!/^\d{1,3}$/.test(groups[0] ?? "") || groups.slice(1).some((g) => !/^\d{3}$/.test(g)))) {
    return null;
  }
  intPart = groups.join("");
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (!intPart && !fracPart) return null;
  const digits = (intPart || "0") + fracPart.padEnd(decimals, "0");
  const trimmed = digits.replace(/^0+(?=\d)/, "");
  // 15 digits keep us inside Number.MAX_SAFE_INTEGER and the core's MAX_AMOUNT (10^15)
  if (trimmed.length > 15) return null;
  const value = Number(trimmed);
  return negative ? -value : value;
}

/** Basis points (8250) → "82,5 %". */
export function formatPercent(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(Math.trunc((bp % 100) / 10));
  return `${whole}${frac ? "," + frac : ""} %`;
}
