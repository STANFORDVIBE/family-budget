import { useLayoutEffect, useRef, useState } from "react";
import { IconBadge } from "@/components/common/icons";
import { useL } from "@/i18n";
import { formatPercent } from "@/lib/money";
import { monthShort } from "@/lib/dates";
import type { BalancePoint, Category, CategoryAmount, SeriesPoint } from "@/lib/types";
import { useMoney } from "@/lib/use-money";

// Small hand-written SVG charts. A charting library is not worth its weight here, and the app
// freezes JS prototypes (Tauri freezePrototype), which common chart libraries do not survive.
//
// Income and expense use the validated categorical pair (blue / orange), not green / red: those two
// are indistinguishable with red-green colour blindness. Text amounts keep green / red plus a sign.
const INCOME = "var(--chart-1)";
const EXPENSE = "var(--chart-2)";
const PAD = { top: 10, right: 8, bottom: 24, left: 64 };

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Up to ~5 round gridline values covering [min, max] (minor units). */
function niceTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const span = hi - lo || 100;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v));
  const last = ticks[ticks.length - 1] ?? 0;
  if (last < hi) ticks.push(Math.round(last + step));
  return ticks;
}

function tickLabel(label: string): string {
  if (/^\d{4}-\d{2}$/.test(label)) return monthShort(label);
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return String(Number(label.slice(8)));
  return label;
}

function fullLabel(label: string): string {
  if (/^\d{4}-\d{2}$/.test(label)) return `${monthShort(label)} ${label.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return `${Number(label.slice(8))}.${label.slice(5, 7)}.${label.slice(0, 4)}`;
  return label;
}

/** Shows every n-th x label so they never collide. */
function labelEvery(count: number, plotWidth: number): number {
  return Math.max(1, Math.ceil(count / Math.max(1, Math.floor(plotWidth / 44))));
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ backgroundColor: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function TooltipBox({
  x,
  width,
  title,
  rows,
}: {
  x: number;
  width: number;
  title: string;
  rows: { color: string; label: string; value: string }[];
}) {
  // Keep the box inside the chart: flip to the left of the cursor near the right edge
  const flip = x > width - 200;
  return (
    <div
      role="status"
      className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-md bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md ring-1 ring-border"
      style={flip ? { right: width - x + 12 } : { left: x + 12 }}
    >
      <div className="mb-1 font-medium">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ backgroundColor: r.color }} />
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-4 font-medium tabular">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Grid({
  ticks,
  y,
  plotWidth,
  format,
}: {
  ticks: number[];
  y: (v: number) => number;
  plotWidth: number;
  format: (v: number) => string;
}) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={PAD.left + plotWidth}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--border)"
            strokeWidth={t === 0 ? 1.5 : 1}
          />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted-foreground)">
            {format(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** A bar with 4px rounded top corners anchored to the baseline. */
function roundedBar(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Income vs expenses per day or month: paired thin bars on one axis, with a hover tooltip. */
export function IncomeExpenseChart({
  data,
  currency,
  height = 240,
}: {
  data: SeriesPoint[];
  currency: string;
  height?: number;
}) {
  const L = useL();
  const { money } = useMoney();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;
  const max = Math.max(0, ...data.map((d) => Math.max(d.income, d.expense)));
  const ticks = niceTicks(0, max);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => PAD.top + plotHeight - (v / top) * plotHeight;
  const band = data.length ? plotWidth / data.length : 0;
  const bar = Math.max(2, Math.min(18, (band - 6) / 2));
  const every = labelEvery(data.length, plotWidth);
  const axisFormat = (v: number) => money(v, currency, { compact: true }).replace(/ \S+$/, "");
  const point = hover !== null ? data[hover] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <Legend
        items={[
          { color: INCOME, label: L.dashboard.income },
          { color: EXPENSE, label: L.dashboard.expense },
        ]}
      />
      <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={L.dashboard.dynamics}>
            <Grid ticks={ticks} y={y} plotWidth={plotWidth} format={axisFormat} />
            {data.map((d, i) => {
              const cx = PAD.left + band * i + band / 2;
              return (
                <g key={d.label}>
                  {hover === i && (
                    <rect x={cx - band / 2} y={PAD.top} width={band} height={plotHeight} fill="var(--muted)" opacity={0.6} />
                  )}
                  {d.income > 0 && (
                    <path d={roundedBar(cx - bar - 1, y(d.income), bar, y(0) - y(d.income))} fill={INCOME} />
                  )}
                  {d.expense > 0 && (
                    <path d={roundedBar(cx + 1, y(d.expense), bar, y(0) - y(d.expense))} fill={EXPENSE} />
                  )}
                  {i % every === 0 && (
                    <text x={cx} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                      {tickLabel(d.label)}
                    </text>
                  )}
                  {/* hit target: the whole column, bigger than the bars */}
                  <rect
                    x={cx - band / 2}
                    y={PAD.top}
                    width={band}
                    height={plotHeight}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {point && hover !== null && (
          <TooltipBox
            x={PAD.left + band * hover + band / 2}
            width={width}
            title={fullLabel(point.label)}
            rows={[
              { color: INCOME, label: L.dashboard.income, value: money(point.income, currency) },
              { color: EXPENSE, label: L.dashboard.expense, value: money(point.expense, currency) },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/** A balance over time: one 2px line with a soft fill and a crosshair tooltip. */
export function BalanceChart({
  data,
  currency,
  name,
  height = 220,
}: {
  data: BalancePoint[];
  currency: string;
  name: string;
  height?: number;
}) {
  const L = useL();
  const { money } = useMoney();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const plotWidth = Math.max(0, width - PAD.left - PAD.right);
  const plotHeight = height - PAD.top - PAD.bottom;
  const values = data.map((d) => d.balance);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const y = (v: number) => PAD.top + plotHeight - ((v - lo) / (hi - lo || 1)) * plotHeight;
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
  const x = (i: number) => PAD.left + (data.length > 1 ? step * i : plotWidth / 2);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.balance)}`).join("");
  const base = y(Math.max(lo, 0));
  const area = data.length ? `${line}L${x(data.length - 1)},${base}L${x(0)},${base}Z` : "";
  const every = labelEvery(data.length, plotWidth);
  const axisFormat = (v: number) => money(v, currency, { compact: true }).replace(/ \S+$/, "");
  const point = hover !== null ? data[hover] : undefined;

  function onMove(event: React.MouseEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left - (step ? step / 2 : 0);
    setHover(Math.max(0, Math.min(data.length - 1, step ? Math.round(px / step) : 0)));
  }

  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{L.analytics.noData}</p>;

  return (
    <div ref={ref} className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={name}>
          <Grid ticks={ticks} y={y} plotWidth={plotWidth} format={axisFormat} />
          <path d={area} fill="var(--chart-1)" opacity={0.12} />
          <path d={line} fill="none" stroke="var(--chart-1)" strokeWidth={2} strokeLinejoin="round" />
          {data.map(
            (d, i) =>
              i % every === 0 && (
                <text
                  key={d.label}
                  x={x(i)}
                  y={height - 6}
                  // Edge labels sit on the plot edges: anchor them inwards so they are not clipped
                  textAnchor={data.length < 2 ? "middle" : i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                  fontSize={11}
                  fill="var(--muted-foreground)"
                >
                  {tickLabel(d.label)}
                </text>
              ),
          )}
          {point && hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={PAD.top + plotHeight}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
              />
              <circle cx={x(hover)} cy={y(point.balance)} r={4.5} fill="var(--chart-1)" stroke="var(--card)" strokeWidth={2} />
            </g>
          )}
          <rect
            x={PAD.left - step / 2}
            y={PAD.top}
            width={plotWidth + step}
            height={plotHeight}
            fill="transparent"
            onMouseMove={onMove}
          />
        </svg>
      )}
      {point && hover !== null && (
        <TooltipBox
          x={x(hover)}
          width={width}
          title={fullLabel(point.label)}
          rows={[
            {
              color: "var(--chart-1)",
              label: point.incomplete ? `${name} *` : name,
              value: money(point.balance, currency),
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * Category structure as a ranked list of bars: easier to read than a pie with many slices.
 * Each row uses the category's own colour and opens the operations on click.
 */
export function CategoryBars({
  items,
  categories,
  currency,
  limit = 8,
  onSelect,
}: {
  items: CategoryAmount[];
  categories: Map<string, Category>;
  currency: string;
  limit?: number;
  onSelect?: (categoryId: string | null) => void;
}) {
  const L = useL();
  const { money } = useMoney();
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  if (total <= 0) return <p className="py-6 text-center text-sm text-muted-foreground">{L.analytics.noData}</p>;
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((sum, i) => sum + i.amount, 0);
  const max = shown[0]?.amount ?? 1;
  const rows = [
    ...shown.map((i) => {
      const c = i.categoryId ? categories.get(i.categoryId) : undefined;
      return {
        key: i.categoryId ?? "none",
        id: i.categoryId,
        name: c?.name ?? (i.categoryId ? "?" : L.common.feesAndOther),
        icon: c?.icon ?? "ellipsis",
        color: c?.color ?? "#94a3b8",
        amount: i.amount,
        clickable: true,
      };
    }),
    ...(rest > 0
      ? [{ key: "rest", id: null, name: L.common.more, icon: "ellipsis", color: "#94a3b8", amount: rest, clickable: false }]
      : []),
  ];
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            disabled={!onSelect || !r.clickable}
            onClick={() => onSelect?.(r.id)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left outline-none enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
            title={onSelect && r.clickable ? L.analytics.clickHint : undefined}
          >
            <IconBadge icon={r.icon} color={r.color} size="sm" />
            <span className="w-36 shrink-0 truncate text-sm">{r.name}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full"
                style={{ width: `${Math.max(2, (r.amount / max) * 100)}%`, backgroundColor: r.color }}
              />
            </span>
            <span className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular">
              {formatPercent(Math.round((r.amount * 10_000) / total))}
            </span>
            <span className="w-28 shrink-0 text-right text-sm font-medium tabular">{money(r.amount, currency)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
