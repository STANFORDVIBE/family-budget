import { create } from "zustand";
import type { Bootstrap, Currency, Settings, Transaction, TransactionFilter, TxKind, User, Workspace } from "@/lib/types";

export type Section =
  | "dashboard"
  | "transactions"
  | "accounts"
  | "analytics"
  | "budgets"
  | "recurring"
  | "goals"
  | "members"
  | "categories"
  | "settings";

/** A "create" request from the quick actions, picked up by the target screen. */
export type CreateIntent = "account" | "goal" | null;

export type TxDialogMode = "create" | "edit" | "copy" | "confirm";

export interface TxDialogState {
  open: boolean;
  mode: TxDialogMode;
  kind?: TxKind;
  transaction?: Transaction;
  accountId?: string;
}

interface AppState {
  user: User | null;
  workspaces: Workspace[];
  currencies: Currency[];
  settings: Settings | null;
  appVersion: string;
  workspaceId: string | null;
  section: Section;
  txDialog: TxDialogState;
  /** Filter handed to the operations screen by a drill-down (analytics, accounts, budgets). */
  operationsPreset: TransactionFilter | null;
  /** Bumped by Ctrl+F; the operations screen focuses its search field when it changes. */
  searchFocusTick: number;
  createIntent: CreateIntent;

  loadBootstrap: (data: Bootstrap) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  setSettings: (settings: Settings) => void;
  setUser: (user: User) => void;
  setWorkspace: (id: string) => void;
  go: (section: Section) => void;
  openOperations: (preset: TransactionFilter) => void;
  consumePreset: () => TransactionFilter | null;
  openTxDialog: (state: Omit<TxDialogState, "open">) => void;
  closeTxDialog: () => void;
  focusSearch: () => void;
  requestCreate: (intent: Exclude<CreateIntent, null>) => void;
  consumeCreate: () => CreateIntent;
}

export const useApp = create<AppState>((set, get) => ({
  user: null,
  workspaces: [],
  currencies: [],
  settings: null,
  appVersion: "",
  workspaceId: null,
  section: "dashboard",
  txDialog: { open: false, mode: "create" },
  operationsPreset: null,
  searchFocusTick: 0,
  createIntent: null,

  loadBootstrap: (data) => {
    const active =
      data.workspaces.find((w) => w.id === data.settings?.activeWorkspaceId)?.id ?? data.workspaces[0]?.id ?? null;
    set({
      user: data.user,
      workspaces: data.workspaces,
      currencies: data.currencies,
      settings: data.settings,
      appVersion: data.appVersion,
      workspaceId: active,
    });
  },
  setWorkspaces: (workspaces) => set({ workspaces }),
  setSettings: (settings) => set({ settings }),
  setUser: (user) => set({ user }),
  setWorkspace: (id) => set({ workspaceId: id, operationsPreset: null }),
  go: (section) => set({ section }),
  openOperations: (preset) => set({ section: "transactions", operationsPreset: preset }),
  consumePreset: () => {
    const preset = get().operationsPreset;
    if (preset) set({ operationsPreset: null });
    return preset;
  },
  openTxDialog: (state) => set({ txDialog: { ...state, open: true } }),
  closeTxDialog: () => set((s) => ({ txDialog: { ...s.txDialog, open: false } })),
  focusSearch: () => set((s) => ({ section: "transactions", searchFocusTick: s.searchFocusTick + 1 })),
  requestCreate: (intent) => set({ section: intent === "account" ? "accounts" : "goals", createIntent: intent }),
  consumeCreate: () => {
    const intent = get().createIntent;
    if (intent) set({ createIntent: null });
    return intent;
  },
}));

/** The active workspace. Screens render only inside the shell, where one always exists. */
export function useWorkspace(): Workspace {
  const workspace = useApp((s) => s.workspaces.find((w) => w.id === s.workspaceId));
  if (!workspace) throw new Error("no active workspace");
  return workspace;
}

export function useCurrency(code: string): Currency {
  const currency = useApp((s) => s.currencies.find((c) => c.code === code));
  return currency ?? { code, name: code, symbol: code, decimals: 2 };
}
