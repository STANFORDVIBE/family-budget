// Exchange rates travel as decimal strings ("97.45"); they are never parsed into floats.

import type { Account } from "@/lib/types";

const MAX_SCALE = 12;

/** "97,45" → "97.45"; null when the text is not a positive decimal the core accepts. */
export function normalizeRate(text: string): string | null {
  const s = text.trim().replace(/\s/g, "").replace(",", ".");
  const match = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!match) return null;
  const intPart = match[1] ?? "";
  const fracPart = (match[2] ?? "").replace(/0+$/, "");
  if (!intPart && !fracPart) return null;
  if (fracPart.length > MAX_SCALE) return null;
  const digits = (intPart + fracPart).replace(/^0+/, "");
  if (!digits || digits.length > 18) return null;
  return fracPart ? `${intPart || "0"}.${fracPart}` : intPart.replace(/^0+(?=\d)/, "");
}

/** Shows a stored rate with the user's decimal separator. */
export function displayRate(rate: string, decimalSeparator = ","): string {
  return rate.replace(".", decimalSeparator);
}

/** Rate of a cross-currency transfer, `to / from`, rounded to 4 decimals for display only. */
export function impliedRate(
  fromMinor: number,
  toMinor: number,
  from: Pick<Account, "currency"> & { decimals?: number },
  to: Pick<Account, "currency"> & { decimals?: number },
): string | null {
  if (fromMinor <= 0 || toMinor <= 0) return null;
  const fromDec = BigInt(from.decimals ?? 2);
  const toDec = BigInt(to.decimals ?? 2);
  // rate = (to / 10^toDec) / (from / 10^fromDec); computed as an integer with 4 extra digits
  const scale = 10_000n;
  const num = BigInt(toMinor) * 10n ** fromDec * scale;
  const den = BigInt(fromMinor) * 10n ** toDec;
  const value = (num * 2n + den) / (den * 2n);
  const whole = value / scale;
  const frac = (value % scale).toString().padStart(4, "0").replace(/0+$/, "");
  return frac ? `${whole},${frac}` : whole.toString();
}
