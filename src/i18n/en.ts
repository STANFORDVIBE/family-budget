import type { DeepPartial } from "@/i18n";
import type { Dictionary } from "@/i18n/ru";

// English is partial for now: missing keys fall back to Russian.
export const en: DeepPartial<Dictionary> = {
  app: { loading: "Loading…" },
  nav: {
    dashboard: "Overview",
    transactions: "Transactions",
    accounts: "Accounts",
    analytics: "Analytics",
    budgets: "Budgets",
    recurring: "Recurring payments",
    goals: "Savings goals",
    members: "Family members",
    categories: "Categories",
    settings: "Settings",
  },
  workspace: { personal: "Personal budget", family: "Family budget" },
  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    copy: "Copy",
    search: "Search",
    today: "Today",
  },
  quick: {
    expense: "Expense",
    income: "Income",
    transfer: "Transfer",
    goal: "Goal",
    account: "Account",
    addOperation: "Add transaction",
  },
  kinds: { expense: "Expense", income: "Income", transfer: "Transfer", refund: "Refund", adjustment: "Adjustment" },
  periods: { week: "Week", month: "Month", quarter: "Quarter", year: "Year", custom: "Custom" },
  dashboard: {
    totalBalance: "Total balance",
    income: "Income",
    expense: "Expenses",
    net: "Net",
    forecast: "End of month forecast",
    recent: "Recent transactions",
    upcoming: "Upcoming payments",
    goals: "Goals",
  },
  settings: { title: "Settings", theme: "Theme", language: "Language" },
};
