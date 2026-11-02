import { invoke } from "@tauri-apps/api/core";
import type {
  Account,
  AccountInput,
  Analytics,
  AnalyticsFilter,
  AuditEntry,
  BackupStatus,
  Bootstrap,
  BudgetView,
  Category,
  CategoryInput,
  Contribution,
  ContributionInput,
  Dashboard,
  ExchangeRate,
  FormMemory,
  GenerationReport,
  Goal,
  GoalInput,
  GoalStatus,
  IntegrityReport,
  Member,
  MemberRole,
  RecurringInput,
  RecurringRule,
  Settings,
  Transaction,
  TransactionFilter,
  TransactionInput,
  TransactionPage,
  User,
  Workspace,
  WorkspaceKind,
} from "@/lib/types";

// One typed function per Rust command. Argument names match the Rust parameters (camelCase).
// Errors reject with { code, message, detail } (see AppError in src-tauri/src/error.rs).

type Ws = { workspaceId: string };

export const api = {
  bootstrap: () => invoke<Bootstrap>("get_bootstrap"),
  completeOnboarding: (input: {
    userName: string;
    personalName: string;
    baseCurrency: string;
    familyName: string | null;
  }) => invoke<Workspace[]>("complete_onboarding", { input }),
  renameUser: (name: string) => invoke<User>("rename_user", { name }),
  createWorkspace: (input: { name: string; kind: WorkspaceKind; baseCurrency: string }) =>
    invoke<Workspace>("create_workspace", { input }),
  updateWorkspace: (workspaceId: string, input: { name: string; baseCurrency: string }) =>
    invoke<Workspace>("update_workspace", { workspaceId, input }),
  updateSettings: (input: Partial<Omit<Settings, "backupDir">>) => invoke<Settings>("update_settings", { input }),
  formMemory: (a: Ws) => invoke<FormMemory>("get_form_memory", a),

  members: (a: Ws) => invoke<Member[]>("list_members", a),
  createMember: (a: Ws & { input: { name: string; role: MemberRole } }) => invoke<Member>("create_member", a),
  updateMember: (a: Ws & { id: string; input: { name: string; role: MemberRole; status: "active" | "inactive" } }) =>
    invoke<Member>("update_member", a),

  accounts: (a: Ws) => invoke<Account[]>("list_accounts", a),
  createAccount: (a: Ws & { input: AccountInput }) => invoke<Account>("create_account", a),
  updateAccount: (a: Ws & { id: string; input: AccountInput }) => invoke<Account>("update_account", a),
  setAccountActive: (a: Ws & { id: string; active: boolean }) => invoke<Account>("set_account_active", a),
  deleteAccount: (a: Ws & { id: string }) => invoke<void>("delete_account", a),

  categories: (a: Ws) => invoke<Category[]>("list_categories", a),
  createCategory: (a: Ws & { input: CategoryInput }) => invoke<Category>("create_category", a),
  updateCategory: (a: Ws & { id: string; input: CategoryInput }) => invoke<Category>("update_category", a),
  setCategoryHidden: (a: Ws & { id: string; hidden: boolean }) => invoke<Category>("set_category_hidden", a),
  deleteCategory: (a: Ws & { id: string; reassignTo: string | null }) => invoke<void>("delete_category", a),

  rates: (a: Ws) => invoke<ExchangeRate[]>("list_rates", a),
  findRate: (a: Ws & { currency: string; date: string }) => invoke<string | null>("find_rate", a),
  upsertRate: (a: Ws & { input: { currency: string; rate: string; rateDate: string } }) =>
    invoke<ExchangeRate>("upsert_rate", a),
  deleteRate: (a: Ws & { id: string }) => invoke<void>("delete_rate", a),

  transactions: (a: Ws & { filter: TransactionFilter }) => invoke<TransactionPage>("list_transactions", a),
  createTransaction: (a: Ws & { input: TransactionInput }) => invoke<Transaction>("create_transaction", a),
  updateTransaction: (a: Ws & { id: string; input: TransactionInput }) =>
    invoke<Transaction>("update_transaction", a),
  confirmTransaction: (a: Ws & { id: string; input: TransactionInput }) =>
    invoke<Transaction>("confirm_transaction", a),
  deleteTransaction: (a: Ws & { id: string }) => invoke<void>("delete_transaction", a),
  restoreTransaction: (a: Ws & { id: string }) => invoke<Transaction>("restore_transaction", a),

  budget: (a: Ws & { month: string }) => invoke<BudgetView>("get_budget", a),
  setBudgetTotal: (a: Ws & { month: string; limit: number | null }) => invoke<BudgetView>("set_budget_total", a),
  setBudgetLimit: (a: Ws & { month: string; input: { categoryId: string; limit: number } }) =>
    invoke<BudgetView>("set_budget_limit", a),
  removeBudgetLimit: (a: Ws & { month: string; categoryId: string }) => invoke<BudgetView>("remove_budget_limit", a),
  copyPreviousBudget: (a: Ws & { month: string }) => invoke<BudgetView>("copy_previous_budget", a),

  recurring: (a: Ws) => invoke<RecurringRule[]>("list_recurring", a),
  createRecurring: (a: Ws & { input: RecurringInput }) => invoke<RecurringRule>("create_recurring", a),
  updateRecurring: (a: Ws & { id: string; input: RecurringInput }) => invoke<RecurringRule>("update_recurring", a),
  setRecurringPaused: (a: Ws & { id: string; paused: boolean }) => invoke<RecurringRule>("set_recurring_paused", a),
  deleteRecurring: (a: Ws & { id: string }) => invoke<void>("delete_recurring", a),
  generateRecurring: (a: Ws) => invoke<GenerationReport>("generate_recurring", a),

  goals: (a: Ws) => invoke<Goal[]>("list_goals", a),
  createGoal: (a: Ws & { input: GoalInput }) => invoke<Goal>("create_goal", a),
  updateGoal: (a: Ws & { id: string; input: GoalInput }) => invoke<Goal>("update_goal", a),
  setGoalStatus: (a: Ws & { id: string; status: GoalStatus }) => invoke<Goal>("set_goal_status", a),
  deleteGoal: (a: Ws & { id: string }) => invoke<void>("delete_goal", a),
  contributions: (a: Ws & { goalId: string }) => invoke<Contribution[]>("list_contributions", a),
  contribute: (a: Ws & { goalId: string; input: ContributionInput }) => invoke<Goal>("contribute_goal", a),
  deleteContribution: (a: Ws & { id: string }) => invoke<void>("delete_contribution", a),

  dashboard: (a: Ws & { from: string; to: string }) => invoke<Dashboard>("get_dashboard", a),
  analytics: (a: Ws & { filter: AnalyticsFilter }) => invoke<Analytics>("get_analytics", a),
  audit: (a: Ws & { filter: { entityId?: string; limit?: number } }) => invoke<AuditEntry[]>("list_audit", a),

  backupStatus: () => invoke<BackupStatus>("get_backup_status"),
  createBackup: () => invoke<string>("create_backup"),
  restoreBackup: (name: string) => invoke<string>("restore_backup", { name }),
  restoreBackupFromFile: () => invoke<string>("restore_backup_from_file"),
  recoverFromFile: () => invoke<void>("recover_from_file"),
  chooseBackupFolder: () => invoke<BackupStatus>("choose_backup_folder"),
  resetBackupFolder: () => invoke<BackupStatus>("reset_backup_folder"),
  openBackupFolder: () => invoke<void>("open_backup_folder"),
  checkIntegrity: () => invoke<IntegrityReport>("check_integrity"),
  exportWorkspace: (a: Ws) => invoke<string>("export_workspace", a),
  exportTransactionsCsv: (a: Ws & { filter: TransactionFilter }) => invoke<string>("export_transactions_csv", a),
};
