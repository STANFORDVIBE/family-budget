import { create } from "zustand";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

// The preference itself lives in the database settings; this cache only avoids a flash of the
// wrong theme before the settings arrive from the core.
const CACHE_KEY = "family-budget:theme";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

function readCached(): ThemePreference {
  try {
    const value = localStorage.getItem(CACHE_KEY);
    if (value === "dark" || value === "light" || value === "system") return value;
  } catch {
    // storage unavailable: fall back to the default
  }
  return "system";
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia(SYSTEM_DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

function applyTheme(theme: ResolvedTheme) {
  const root = document.documentElement;
  // Switch instantly: without this, every transition-colors element fades between themes
  root.classList.add("theme-switching");
  root.classList.toggle("dark", theme === "dark");
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  if (isTauri()) void getCurrentWindow().setTheme(theme).catch(() => undefined);
}

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => {
  const preference = readCached();
  return {
    preference,
    resolved: resolveTheme(preference),
    setPreference: (next) => {
      try {
        localStorage.setItem(CACHE_KEY, next);
      } catch {
        // not cached, still applied
      }
      set({ preference: next, resolved: resolveTheme(next) });
    },
  };
});

/** Applies the current theme to the document and keeps "system" in sync with Windows. */
export function initTheme() {
  applyTheme(useThemeStore.getState().resolved);
  useThemeStore.subscribe((state, prev) => {
    if (state.resolved !== prev.resolved) applyTheme(state.resolved);
  });
  window.matchMedia(SYSTEM_DARK_QUERY).addEventListener("change", () => {
    const { preference } = useThemeStore.getState();
    if (preference === "system") useThemeStore.setState({ resolved: resolveTheme("system") });
  });
}
