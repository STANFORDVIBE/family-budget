import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useMoney } from "@/lib/use-money";
import { parseMoney, toInputValue } from "@/lib/money";
import { cn } from "@/lib/utils";

interface AmountInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  /** Minor units, or null when the field is empty or invalid. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  currency: string;
  allowNegative?: boolean;
  invalid?: boolean;
}

/**
 * Money field that keeps the typed text and reports integer minor units. Accepts "12,50",
 * "12.50" and "1 234,50"; never goes through floating point.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onValueChange, currency, allowNegative = false, invalid, className, onBlur, ...props },
  ref,
) {
  const { decimals, symbol, format } = useMoney();
  const digits = decimals(currency);
  const [text, setText] = useState(() => (value === null ? "" : toInputValue(value, digits, format)));

  // Follow value changes made outside the field (form reset, "fill balance" buttons)
  useEffect(() => {
    setText((current) => {
      const parsed = parseMoney(current, digits, allowNegative);
      if (parsed === value) return current;
      return value === null ? "" : toInputValue(value, digits, format);
    });
  }, [value, digits, format, allowNegative]);

  return (
    <div className="relative">
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={invalid || undefined}
        className={cn("tabular pr-12 text-right text-base", className)}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          onValueChange(next.trim() === "" ? null : parseMoney(next, digits, allowNegative));
        }}
        onBlur={(event) => {
          const parsed = parseMoney(text, digits, allowNegative);
          if (parsed !== null) setText(toInputValue(parsed, digits, format));
          onBlur?.(event);
        }}
        {...props}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">
        {symbol(currency)}
      </span>
    </div>
  );
});
