import type { Section } from "@/store/app";

// Sidebar groups in their default order. The user may reorder each group by dragging.
export const MAIN_SECTIONS: Section[] = [
  "dashboard",
  "transactions",
  "accounts",
  "analytics",
  "budgets",
  "recurring",
  "goals",
];
export const SECONDARY_SECTIONS: Section[] = ["members", "categories", "settings"];

/** `defaults` in the user's saved order; sections the saved order does not know keep their default place after it. */
export function orderSections(defaults: Section[], saved: readonly string[]): Section[] {
  const rank = (s: Section) => {
    const i = saved.indexOf(s);
    return i === -1 ? saved.length + defaults.indexOf(s) : i;
  };
  return [...defaults].sort((a, b) => rank(a) - rank(b));
}

/** Moves `item` into the place of `target`: the others shift towards where `item` was. */
export function moveTo<T>(list: T[], item: T, target: T): T[] {
  const from = list.indexOf(item);
  const to = list.indexOf(target);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.filter((x) => x !== item);
  next.splice(to, 0, item);
  return next;
}
