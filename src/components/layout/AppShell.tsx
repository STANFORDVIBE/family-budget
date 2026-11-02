import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { AccountsPage } from "@/features/accounts/AccountsPage";
import { AnalyticsPage } from "@/features/analytics/AnalyticsPage";
import { BudgetsPage } from "@/features/budgets/BudgetsPage";
import { CategoriesPage } from "@/features/categories/CategoriesPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { GoalsPage } from "@/features/goals/GoalsPage";
import { MembersPage } from "@/features/members/MembersPage";
import { RecurringPage } from "@/features/recurring/RecurringPage";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { TransactionDialog } from "@/features/transactions/TransactionDialog";
import { TransactionsPage } from "@/features/transactions/TransactionsPage";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { type Section, useApp } from "@/store/app";

const HOTKEY_SECTIONS: Record<string, Section> = {
  "1": "dashboard",
  "2": "transactions",
  "3": "accounts",
  "4": "analytics",
  "5": "budgets",
  "6": "recurring",
  "7": "goals",
};

export function AppShell({ onReload }: { onReload: () => Promise<void> }) {
  const workspaceId = useApp((s) => s.workspaceId);
  const section = useApp((s) => s.section);
  useRecurringGeneration(workspaceId);
  useHotkeys();

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1" key={workspaceId}>
          <SectionView section={section} onReload={onReload} />
        </main>
      </div>
      <TransactionDialog />
    </div>
  );
}

function SectionView({ section, onReload }: { section: Section; onReload: () => Promise<void> }) {
  switch (section) {
    case "dashboard":
      return <DashboardPage />;
    case "transactions":
      return <TransactionsPage />;
    case "accounts":
      return <AccountsPage />;
    case "analytics":
      return <AnalyticsPage />;
    case "budgets":
      return <BudgetsPage />;
    case "recurring":
      return <RecurringPage />;
    case "goals":
      return <GoalsPage />;
    case "members":
      return <MembersPage />;
    case "categories":
      return <CategoriesPage />;
    case "settings":
      return <SettingsPage onReload={onReload} />;
  }
}

/** Creates due recurring payments (as "pending") when the app starts and on workspace switch. */
function useRecurringGeneration(workspaceId: string | null) {
  const client = useQueryClient();
  const L = useL();
  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    api
      .generateRecurring({ workspaceId })
      .then(async (report) => {
        if (cancelled) return;
        if (report.created > 0) {
          await client.invalidateQueries({ queryKey: [workspaceId] });
          toast.info(fmt(L.recurring.generated, { n: report.created }));
        }
        for (const name of report.failedRules) toast.warning(fmt(L.recurring.failed, { name }));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // L is stable per language; regenerating on a language switch is unnecessary
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, client]);
}

/** Ctrl+N new operation, Ctrl+F search operations, Ctrl+1…7 switch screens. */
function useHotkeys() {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const state = useApp.getState();
      const key = event.key.toLowerCase();
      // Ctrl+N / Ctrl+F also arrive with a Cyrillic layout as "т" / "а": use the physical key
      if (event.code === "KeyN" || key === "n") {
        event.preventDefault();
        if (!state.txDialog.open) state.openTxDialog({ mode: "create" });
      } else if (event.code === "KeyF" || key === "f") {
        event.preventDefault();
        state.focusSearch();
      } else if (!event.shiftKey && HOTKEY_SECTIONS[event.key]) {
        event.preventDefault();
        state.go(HOTKEY_SECTIONS[event.key] as Section);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
