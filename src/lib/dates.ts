// Calendar days as 'YYYY-MM-DD' strings in local time, matching the core.

import type { Settings } from "@/lib/types";

export type DateFormat = Settings["dateFormat"];
export type PeriodKind = "week" | "month" | "quarter" | "year" | "custom";

export interface Period {
  kind: PeriodKind;
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function todayIso(): string {
  return toIso(new Date());
}

export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

export function formatDate(iso: string, format: DateFormat = "dd.MM.yyyy"): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  if (format === "yyyy-MM-dd") return iso;
  if (format === "MM/dd/yyyy") return `${m}/${d}/${y}`;
  return `${d}.${m}.${y}`;
}

const MONTHS = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const MONTHS_GENITIVE = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** '2025-03' → 'Март 2025'. */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** '2025-03' → 'мар' (chart axes). */
export function monthShort(month: string): string {
  const m = Number(month.split("-")[1]);
  return MONTHS_SHORT[m - 1] ?? month;
}

/** '2025-03-08' → '8 марта' (or with year if not the current one). */
export function dayLabel(iso: string): string {
  const d = fromIso(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}${sameYear ? "" : " " + d.getFullYear()}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y ?? 1970, m ?? 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

/** The period of the given kind that contains `anchor` (default today). Weeks start on Monday. */
export function periodFor(kind: Exclude<PeriodKind, "custom">, anchor: Date = new Date()): Period {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  switch (kind) {
    case "week": {
      const offset = (anchor.getDay() + 6) % 7;
      const start = new Date(y, m, anchor.getDate() - offset);
      const end = new Date(y, m, anchor.getDate() - offset + 6);
      return { kind, from: toIso(start), to: toIso(end) };
    }
    case "month":
      return { kind, from: toIso(new Date(y, m, 1)), to: toIso(new Date(y, m + 1, 0)) };
    case "quarter": {
      const q = Math.floor(m / 3) * 3;
      return { kind, from: toIso(new Date(y, q, 1)), to: toIso(new Date(y, q + 3, 0)) };
    }
    case "year":
      return { kind, from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

/** Moves a period one step back or forward, keeping its kind. */
export function shiftPeriod(period: Period, delta: number): Period {
  const from = fromIso(period.from);
  switch (period.kind) {
    case "week":
      return periodFor("week", new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7 * delta));
    case "month":
      return periodFor("month", new Date(from.getFullYear(), from.getMonth() + delta, 1));
    case "quarter":
      return periodFor("quarter", new Date(from.getFullYear(), from.getMonth() + 3 * delta, 1));
    case "year":
      return periodFor("year", new Date(from.getFullYear() + delta, 0, 1));
    case "custom": {
      const to = fromIso(period.to);
      const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
      const shift = (d: Date) => toIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days * delta));
      return { kind: "custom", from: shift(from), to: shift(to) };
    }
  }
}

export function periodLabel(period: Period, format: DateFormat): string {
  switch (period.kind) {
    case "month":
      return monthLabel(period.from.slice(0, 7));
    case "year":
      return period.from.slice(0, 4);
    case "quarter":
      return `${Math.floor(Number(period.from.slice(5, 7)) / 3) + 1} квартал ${period.from.slice(0, 4)}`;
    default:
      return `${formatDate(period.from, format)} — ${formatDate(period.to, format)}`;
  }
}
