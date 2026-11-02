import { useMoney } from "@/lib/use-money";
import { cn } from "@/lib/utils";

/**
 * An amount. `tone` colours it: income green, expense soft red, auto by sign.
 * Amounts are always tabular so columns line up.
 */
export function Money({
  amount,
  currency,
  tone = "none",
  sign = false,
  compact = false,
  className,
}: {
  amount: number;
  currency: string;
  tone?: "none" | "auto" | "income" | "expense" | "muted";
  sign?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const { money } = useMoney();
  const resolved = tone === "auto" ? (amount > 0 ? "income" : amount < 0 ? "expense" : "none") : tone;
  return (
    <span
      data-selectable
      className={cn(
        "tabular whitespace-nowrap",
        resolved === "income" && "text-income",
        resolved === "expense" && "text-expense",
        resolved === "muted" && "text-muted-foreground",
        className,
      )}
    >
      {money(amount, currency, { sign, compact })}
    </span>
  );
}
