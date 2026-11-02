import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage, isCancelled } from "@/lib/errors";
import type { AnalyticsFilter, TransactionFilter } from "@/lib/types";
import { useApp } from "@/store/app";

// Every workspace query key starts with the workspace id, so one invalidation of [workspaceId]
// refreshes all screens after any write (balances, budgets and analytics all depend on each other).

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false },
    mutations: { retry: false },
  },
});

function useWs(): string {
  const id = useApp((s) => s.workspaceId);
  return id ?? "";
}

export function useAccounts() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "accounts"], queryFn: () => api.accounts({ workspaceId }) });
}

export function useCategories() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "categories"], queryFn: () => api.categories({ workspaceId }) });
}

export function useMembers() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "members"], queryFn: () => api.members({ workspaceId }) });
}

export function useRates() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "rates"], queryFn: () => api.rates({ workspaceId }) });
}

export function useFindRate(currency: string | null, date: string) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "rate", currency, date],
    queryFn: () => api.findRate({ workspaceId, currency: currency ?? "", date }),
    enabled: currency !== null,
  });
}

export function useTransactions(filter: TransactionFilter) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "transactions", filter],
    queryFn: () => api.transactions({ workspaceId, filter }),
    placeholderData: keepPreviousData,
  });
}

export function useBudget(month: string) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "budget", month],
    queryFn: () => api.budget({ workspaceId, month }),
    placeholderData: keepPreviousData,
  });
}

export function useRecurring() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "recurring"], queryFn: () => api.recurring({ workspaceId }) });
}

export function useGoals() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "goals"], queryFn: () => api.goals({ workspaceId }) });
}

export function useContributions(goalId: string | null) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "contributions", goalId],
    queryFn: () => api.contributions({ workspaceId, goalId: goalId ?? "" }),
    enabled: goalId !== null,
  });
}

export function useDashboard(from: string, to: string) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "dashboard", from, to],
    queryFn: () => api.dashboard({ workspaceId, from, to }),
    placeholderData: keepPreviousData,
  });
}

export function useAnalytics(filter: AnalyticsFilter) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "analytics", filter],
    queryFn: () => api.analytics({ workspaceId, filter }),
    placeholderData: keepPreviousData,
  });
}

export function useAudit(filter: { entityId?: string; limit?: number }, enabled = true) {
  const workspaceId = useWs();
  return useQuery({
    queryKey: [workspaceId, "audit", filter],
    queryFn: () => api.audit({ workspaceId, filter }),
    enabled,
  });
}

export function useFormMemory() {
  const workspaceId = useWs();
  return useQuery({ queryKey: [workspaceId, "formMemory"], queryFn: () => api.formMemory({ workspaceId }) });
}

export function useBackupStatus() {
  return useQuery({ queryKey: ["backup"], queryFn: () => api.backupStatus() });
}

/**
 * A write to the active workspace: shows a readable error toast on failure and refreshes every
 * query of the workspace on success. `success` is an optional toast text.
 */
export function useWsMutation<TArgs, TResult>(
  fn: (workspaceId: string, args: TArgs) => Promise<TResult>,
  options: { success?: string | ((result: TResult) => string); onSuccess?: (result: TResult) => void } = {},
) {
  const workspaceId = useWs();
  const client = useQueryClient();
  const L = useL();
  return useMutation({
    mutationFn: (args: TArgs) => fn(workspaceId, args),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: [workspaceId] });
      const text = typeof options.success === "function" ? options.success(result) : options.success;
      if (text) toast.success(text);
      options.onSuccess?.(result);
    },
    onError: (error) => {
      if (!isCancelled(error)) toast.error(errorMessage(error, L));
    },
  });
}

/** A write outside any workspace (backups, settings): same error handling, refreshes everything. */
export function useAppMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: { success?: string | ((result: TResult) => string); onSuccess?: (result: TResult) => void } = {},
) {
  const client = useQueryClient();
  const L = useL();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      await client.invalidateQueries();
      const text = typeof options.success === "function" ? options.success(result) : options.success;
      if (text) toast.success(text);
      options.onSuccess?.(result);
    },
    onError: (error) => {
      if (!isCancelled(error)) toast.error(errorMessage(error, L));
    },
  });
}
