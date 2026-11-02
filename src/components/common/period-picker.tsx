import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useL } from "@/i18n";
import { type Period, type PeriodKind, periodFor, periodLabel, shiftPeriod } from "@/lib/dates";
import { useApp } from "@/store/app";

/** Week / month / quarter / year / custom period with back and forward arrows. */
export function PeriodPicker({
  value,
  onChange,
  kinds = ["week", "month", "quarter", "year", "custom"],
}: {
  value: Period;
  onChange: (period: Period) => void;
  kinds?: PeriodKind[];
}) {
  const L = useL();
  const dateFormat = useApp((s) => s.settings?.dateFormat ?? "dd.MM.yyyy");
  const options = kinds.map((kind) => ({ value: kind, label: L.periods[kind] }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedControl
        aria-label={L.periods.custom}
        value={value.kind}
        options={options}
        onValueChange={(kind) =>
          onChange(kind === "custom" ? { ...value, kind: "custom" } : periodFor(kind, new Date()))
        }
      />
      {value.kind === "custom" ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label={L.common.from}
            className="w-38"
            value={value.from}
            max={value.to}
            onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            aria-label={L.common.to}
            className="w-38"
            value={value.to}
            min={value.from}
            onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
          />
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label={L.periods.prev} onClick={() => onChange(shiftPeriod(value, -1))}>
            <ChevronLeft />
          </Button>
          <span className="min-w-36 text-center text-sm font-medium">{periodLabel(value, dateFormat)}</span>
          <Button variant="ghost" size="icon-sm" aria-label={L.periods.next} onClick={() => onChange(shiftPeriod(value, 1))}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

/** Month stepper for budgets: ‹ Март 2025 ›. */
export function MonthStepper({ value, onChange }: { value: string; onChange: (month: string) => void }) {
  const L = useL();
  const dateFormat = useApp((s) => s.settings?.dateFormat ?? "dd.MM.yyyy");
  const period = periodFor("month", new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1));
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={L.periods.prev}
        onClick={() => onChange(shiftPeriod(period, -1).from.slice(0, 7))}
      >
        <ChevronLeft />
      </Button>
      <span className="min-w-32 text-center text-sm font-medium">{periodLabel(period, dateFormat)}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={L.periods.next}
        onClick={() => onChange(shiftPeriod(period, 1).from.slice(0, 7))}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
