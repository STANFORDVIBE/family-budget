import { fmt } from "@/i18n";
import type { Dictionary } from "@/i18n/ru";
import type { AppError } from "@/lib/types";

export function isAppError(value: unknown): value is AppError {
  return typeof value === "object" && value !== null && "code" in value && typeof value.code === "string";
}

/** A file dialog closed without choosing: not an error worth showing. */
export function isCancelled(error: unknown): boolean {
  return isAppError(error) && error.code === "cancelled";
}

/** Human message for any error from the core; never shows internals. */
export function errorMessage(error: unknown, L: Dictionary): string {
  if (!isAppError(error)) return L.errors.generic;
  const E = L.errors;
  switch (error.code) {
    case "validation":
      return (error.detail && E.fields[error.detail]) || E.validation;
    case "conflict":
      return (error.detail && E.conflicts[error.detail]) || E.conflict;
    case "rate_missing":
      return fmt(E.rate_missing, { detail: error.detail ?? "" });
    case "not_found":
      return E.not_found;
    case "database":
      return E.database;
    case "io":
      return E.io;
    case "invalid_backup":
      return E.invalid_backup;
    case "unsupported_version":
      return E.unsupported_version;
    case "integrity":
      return E.integrity;
    case "overflow":
      return E.overflow;
    default:
      return E.generic;
  }
}
