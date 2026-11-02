import { useCallback } from "react";
import { formatMinor, formatMinorCompact } from "@/lib/money";
import { useApp } from "@/store/app";

export const HIDDEN = "•••";

/** Formats minor units of a currency with the user's number format and the "hide amounts" switch. */
export function useMoney() {
  const currencies = useApp((s) => s.currencies);
  const format = useApp((s) => s.settings?.numberFormat ?? "space_comma");
  const hidden = useApp((s) => s.settings?.hideAmounts ?? false);

  const decimals = useCallback(
    (code: string) => currencies.find((c) => c.code === code)?.decimals ?? 2,
    [currencies],
  );
  const symbol = useCallback(
    (code: string) => currencies.find((c) => c.code === code)?.symbol ?? code,
    [currencies],
  );

  const money = useCallback(
    (amount: number, currency: string, opts: { sign?: boolean; compact?: boolean } = {}) => {
      if (hidden) return `${HIDDEN} ${symbol(currency)}`;
      const body = opts.compact
        ? formatMinorCompact(amount, decimals(currency), format)
        : formatMinor(amount, decimals(currency), format);
      const sign = opts.sign && amount > 0 ? "+" : "";
      return `${sign}${body} ${symbol(currency)}`;
    },
    [decimals, format, hidden, symbol],
  );

  return { money, decimals, symbol, format, hidden };
}
