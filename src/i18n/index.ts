import { useMemo } from "react";
import { en } from "@/i18n/en";
import { ru, type Dictionary } from "@/i18n/ru";
import { useApp } from "@/store/app";

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T extends object>(base: T, override: DeepPartial<T> | undefined): T {
  if (!override) return base;
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = (base as Record<string, unknown>)[key];
    result[key] =
      value && typeof value === "object" && baseValue && typeof baseValue === "object"
        ? merge(baseValue as object, value as DeepPartial<object>)
        : value;
  }
  return result as T;
}

const dictionaries = { ru, en: merge(ru, en) } satisfies Record<string, Dictionary>;

/** Current UI dictionary: `const L = useL(); L.nav.dashboard`. */
export function useL(): Dictionary {
  const language = useApp((s) => s.settings?.language ?? "ru");
  return useMemo(() => dictionaries[language] ?? ru, [language]);
}

/** Fills `{name}` placeholders. */
export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}
