// Shapes returned by the Rust core (serde camelCase). Amounts are integer minor units.

export type WorkspaceKind = "personal" | "family";
export type TxKind = "expense" | "income" | "transfer" | "refund" | "adjustment";
export type TxStatus = "posted" | "pending";
export type AccountKind = "cash" | "debit_card" | "credit_card" | "bank" | "savings" | "ewallet" | "other";
export type CategoryKind = "expense" | "income";
export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type LimitStatus = "ok" | "warning" | "over";
export type IntervalUnit = "day" | "week" | "month" | "year";
export type GoalStatus = "active" | "achieved" | "archived";

export interface AppError {
  code: string;
  message: string;
  detail: string | null;
}

export interface User {
  id: string;
  name: string;
}

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  decimals: number;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  baseCurrency: string;
  createdAt: number;
  version: number;
}

export interface Settings {
  theme: "light" | "dark" | "system";
  language: "ru" | "en";
  dateFormat: "dd.MM.yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy";
  numberFormat: "space_comma" | "comma_dot" | "dot_comma";
  hideAmounts: boolean;
  autoBackup: boolean;
  backupKeep: number;
  backupDir: string | null;
  activeWorkspaceId: string | null;
  /** Sidebar order chosen by dragging; empty means the default order. */
  navOrder: string[];
}

export interface Bootstrap {
  openError: string | null;
  user: User | null;
  workspaces: Workspace[];
  currencies: Currency[];
  settings: Settings | null;
  appVersion: string;
}

export interface Member {
  id: string;
  workspaceId: string;
  name: string;
  role: MemberRole;
  status: "active" | "inactive";
  joinedOn: string;
  isMe: boolean;
  version: number;
}

export interface Account {
  id: string;
  workspaceId: string;
  name: string;
  kind: AccountKind;
  currency: string;
  initialBalance: number;
  balance: number;
  creditLimit: number | null;
  icon: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: number;
  version: number;
  hasOperations: boolean;
}

export interface AccountInput {
  id?: string;
  name: string;
  kind: AccountKind;
  currency: string;
  initialBalance: number;
  creditLimit: number | null;
  icon: string;
  color: string;
}

export interface Category {
  id: string;
  parentId: string | null;
  kind: CategoryKind;
  name: string;
  icon: string;
  color: string;
  isHidden: boolean;
  sortOrder: number;
  usageCount: number;
  version: number;
}

export interface CategoryInput {
  id?: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  icon: string;
  color: string;
}

export interface ExchangeRate {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate: string;
  rateDate: string;
  source: string;
  version: number;
}

export interface Transaction {
  id: string;
  kind: TxKind;
  status: TxStatus;
  date: string;
  accountId: string;
  amount: number;
  currency: string;
  baseAmount: number | null;
  rate: string | null;
  toAccountId: string | null;
  toAmount: number | null;
  toCurrency: string | null;
  fee: number;
  categoryId: string | null;
  memberId: string | null;
  comment: string | null;
  createdBy: string;
  recurringRuleId: string | null;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface TransactionInput {
  id?: string;
  kind: TxKind;
  date: string;
  accountId: string;
  amount: number;
  targetBalance?: number | null;
  toAccountId?: string | null;
  toAmount?: number | null;
  fee?: number | null;
  categoryId?: string | null;
  memberId?: string | null;
  comment?: string | null;
  rate?: string | null;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  kinds?: TxKind[];
  accountId?: string;
  categoryId?: string;
  memberId?: string;
  currency?: string;
  search?: string;
  status?: "posted" | "pending" | "all";
  sort?: "date_desc" | "date_asc" | "amount_desc" | "amount_asc";
  limit?: number;
  offset?: number;
}

export interface TransactionPage {
  items: Transaction[];
  total: number;
}

export interface LimitView {
  id: string;
  categoryId: string;
  limit: number;
  spent: number;
  remaining: number;
  percentBp: number;
  status: LimitStatus;
  forecast: number;
}

export interface BudgetView {
  month: string;
  currency: string;
  budgetId: string | null;
  totalLimit: number | null;
  totalSpent: number;
  totalRemaining: number | null;
  totalPercentBp: number | null;
  totalStatus: LimitStatus | null;
  totalForecast: number;
  limits: LimitView[];
  unbudgetedSpent: number;
}

export interface RecurringRule {
  id: string;
  name: string;
  kind: "expense" | "income";
  amount: number;
  currency: string;
  accountId: string;
  categoryId: string;
  memberId: string | null;
  comment: string | null;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  startDate: string;
  nextDate: string;
  endDate: string | null;
  status: "active" | "paused" | "finished";
  pendingCount: number;
  version: number;
}

export interface RecurringInput {
  id?: string;
  name: string;
  kind: "expense" | "income";
  amount: number;
  accountId: string;
  categoryId: string;
  memberId: string | null;
  comment: string | null;
  intervalUnit: IntervalUnit;
  intervalCount: number;
  startDate: string;
  endDate: string | null;
}

export interface GenerationReport {
  created: number;
  failedRules: string[];
}

export interface Upcoming {
  ruleId: string;
  name: string;
  kind: "expense" | "income";
  amount: number;
  currency: string;
  date: string;
}

export interface GoalProgress {
  current: number;
  remaining: number;
  percentBp: number;
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  overdue: boolean;
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  currency: string;
  targetDate: string | null;
  accountId: string | null;
  description: string | null;
  icon: string;
  color: string;
  status: GoalStatus;
  progress: GoalProgress;
  createdAt: number;
  version: number;
}

export interface GoalInput {
  id?: string;
  name: string;
  target: number;
  currency: string;
  targetDate: string | null;
  accountId: string | null;
  description: string | null;
  icon: string;
  color: string;
}

export interface Contribution {
  id: string;
  goalId: string;
  amount: number;
  date: string;
  transactionId: string | null;
  comment: string | null;
  createdAt: number;
}

export interface ContributionInput {
  id?: string;
  amount: number;
  date: string;
  accountId: string | null;
  comment: string | null;
}

export interface Totals {
  income: number;
  expense: number;
  net: number;
}

export interface SeriesPoint {
  label: string;
  income: number;
  expense: number;
}

export interface CategoryAmount {
  categoryId: string | null;
  amount: number;
}

export interface BalancePoint {
  label: string;
  balance: number;
  incomplete: boolean;
}

export interface Dashboard {
  currency: string;
  from: string;
  to: string;
  totalBalance: number;
  creditDebt: number;
  missingRates: string[];
  totals: Totals;
  budget: { limit: number; spent: number; remaining: number } | null;
  forecastEndOfMonth: number;
  expenseByCategory: CategoryAmount[];
  series: SeriesPoint[];
  seriesGranularity: "day" | "month";
  recent: Transaction[];
  pending: Transaction[];
  upcoming: Upcoming[];
  goals: Goal[];
  hasAccounts: boolean;
}

export interface AnalyticsFilter {
  from: string;
  to: string;
  categoryId?: string;
  accountId?: string;
  memberId?: string;
  currency?: string;
}

export interface Analytics {
  currency: string;
  totals: Totals;
  byMonth: SeriesPoint[];
  expenseByCategory: CategoryAmount[];
  incomeByCategory: CategoryAmount[];
  comparisonMonth: string;
  categoryComparison: { categoryId: string | null; current: number; previous: number }[];
  balanceHistory: BalancePoint[];
  savingsHistory: BalancePoint[];
  missingRates: string[];
}

export interface AuditEntry {
  id: string;
  entity: string;
  entityId: string;
  action: string;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  at: number;
  userName: string | null;
}

export interface BackupFile {
  name: string;
  size: number;
  modifiedAt: number;
  automatic: boolean;
}

export interface BackupStatus {
  dir: string;
  isCustomDir: boolean;
  autoBackup: boolean;
  keep: number;
  lastBackupAt: number | null;
  files: BackupFile[];
}

/** A newer release found on GitHub. */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

export interface IntegrityReport {
  ok: boolean;
  issues: [string, number][];
  checkedAt: number;
}

export interface FormMemory {
  lastKind: TxKind | null;
  lastAccountId: string | null;
}
