import { CalendarClock, CircleAlert, Info, Target, Wallet } from "lucide-react";
import { useMemo, useState } from "react";
import { IconBadge } from "@/components/common/icons";
import { EmptyState, Page, ProgressBar, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { PeriodPicker } from "@/components/common/period-picker";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CategoryBars, IncomeExpenseChart } from "@/features/analytics/charts";
import { TransactionRow } from "@/features/transactions/TransactionRow";
import { fmt, useL } from "@/i18n";
import { type Period, dayLabel, fromIso, periodFor, todayIso } from "@/lib/dates";
import { toLookups } from "@/lib/lookups";
import { formatPercent } from "@/lib/money";
import { useAccounts, useCategories, useDashboard, useMembers } from "@/lib/queries";
import type { Dashboard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

export function DashboardPage() {
  const L = useL();
  const [period, setPeriod] = useState<Period>(() => periodFor("month"));
  const { data, isLoading } = useDashboard(period.from, period.to);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const lookups = useMemo(() => toLookups(accounts, categories, members), [accounts, categories, members]);

  if (isLoading || !data) {
    return (
      <Page>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </Page>
    );
  }

  if (!data.hasAccounts) {
    return (
      <Page>
        <Card>
          <EmptyState
            icon={Wallet}
            title={L.dashboard.welcomeTitle}
            text={L.dashboard.welcomeText}
            action={<Button onClick={() => useApp.getState().requestCreate("account")}>{L.dashboard.addAccount}</Button>}
          />
        </Card>
      </Page>
    );
  }

  const drill = (categoryId: string | null) =>
    useApp.getState().openOperations({
      from: period.from,
      to: period.to,
      categoryId: categoryId ?? undefined,
      kinds: ["expense", "refund"],
      status: "posted",
    });

  return (
    <Page>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {data.missingRates.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <CircleAlert className="size-4 text-warning" />
          {fmt(L.dashboard.missingRates, { list: data.missingRates.join(", ") })}
        </div>
      )}

      <Summary data={data} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader>
            <CardTitle>{L.dashboard.dynamics}</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpenseChart data={data.series} currency={data.currency} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{L.dashboard.byCategory}</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBars
              items={data.expenseByCategory}
              categories={lookups.categories}
              currency={data.currency}
              limit={6}
              onSelect={drill}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{L.dashboard.recent}</CardTitle>
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => useApp.getState().go("transactions")}>
                {L.dashboard.allOperations}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="gap-0">
            {data.pending.length > 0 && (
              <div className="mb-2 flex flex-col">
                <div className="px-2 pb-1 text-xs font-medium text-warning">{L.dashboard.pending}</div>
                {data.pending.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} lookups={lookups} />
                ))}
              </div>
            )}
            {data.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{L.dashboard.noOperations}</p>
            ) : (
              data.recent.map((tx) => <TransactionRow key={tx.id} tx={tx} lookups={lookups} />)
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <Upcoming data={data} />
          <Goals data={data} />
        </div>
      </div>
    </Page>
  );
}

function Summary({ data }: { data: Dashboard }) {
  const L = useL();
  const budget = data.budget;
  const budgetBp = budget && budget.limit > 0 ? Math.round((budget.spent * 10_000) / budget.limit) : 0;
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Stat label={L.dashboard.totalBalance} testId="total-balance">
        <Money amount={data.totalBalance} currency={data.currency} className="text-2xl font-semibold" />
        {data.creditDebt > 0 && (
          <div className="text-xs text-muted-foreground">
            {L.dashboard.creditDebt}: <Money amount={data.creditDebt} currency={data.currency} />
          </div>
        )}
      </Stat>
      <Stat label={`${L.dashboard.income} / ${L.dashboard.expense}`}>
        <div className="flex flex-col">
          <Money amount={data.totals.income} currency={data.currency} tone="income" sign className="text-lg font-semibold" />
          <Money
            amount={-data.totals.expense}
            currency={data.currency}
            tone="expense"
            className="text-lg font-semibold"
          />
        </div>
        <div className="text-xs text-muted-foreground">
          {L.dashboard.net}: <Money amount={data.totals.net} currency={data.currency} sign />
        </div>
      </Stat>
      <Stat label={L.dashboard.budgetLeft}>
        {budget ? (
          <>
            <Money
              amount={budget.remaining}
              currency={data.currency}
              tone={budget.remaining < 0 ? "expense" : "none"}
              className="text-2xl font-semibold"
            />
            <ProgressBar bp={budgetBp} status={budgetBp > 10_000 ? "over" : budgetBp >= 8_000 ? "warning" : "ok"} />
            <div className="text-xs text-muted-foreground">
              {formatPercent(budgetBp)} {L.dashboard.budgetOf} <Money amount={budget.limit} currency={data.currency} />
            </div>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">{L.dashboard.noBudget}</span>
            <Button variant="link" className="h-auto justify-start p-0" onClick={() => useApp.getState().go("budgets")}>
              {L.dashboard.setBudget}
            </Button>
          </>
        )}
      </Stat>
      <Stat
        label={
          <span className="flex items-center gap-1">
            {L.dashboard.forecast}
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="size-3.5" aria-label={L.dashboard.forecastHint} />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{L.dashboard.forecastHint}</TooltipContent>
            </Tooltip>
          </span>
        }
      >
        <Money amount={data.forecastEndOfMonth} currency={data.currency} className="text-2xl font-semibold" />
      </Stat>
    </div>
  );
}

function Stat({ label, children, testId }: { label: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <Card size="sm" data-testid={testId}>
      <CardContent className="gap-1.5">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {children}
      </CardContent>
    </Card>
  );
}

function Upcoming({ data }: { data: Dashboard }) {
  const L = useL();
  const today = fromIso(todayIso()).getTime();
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{L.dashboard.upcoming}</CardTitle>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label={L.nav.recurring} onClick={() => useApp.getState().go("recurring")}>
            <CalendarClock />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="gap-1">
        {data.upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">{L.dashboard.noUpcoming}</p>
        ) : (
          data.upcoming.slice(0, 5).map((u) => {
            const days = Math.round((fromIso(u.date).getTime() - today) / 86_400_000);
            return (
              <div key={`${u.ruleId}-${u.date}`} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{u.name}</span>
                <span className="text-xs text-muted-foreground">
                  {days <= 0 ? L.dashboard.todayShort : days < 8 ? fmt(L.dashboard.inDays, { n: days }) : dayLabel(u.date)}
                </span>
                <Money
                  amount={u.kind === "expense" ? -u.amount : u.amount}
                  currency={u.currency}
                  tone={u.kind === "expense" ? "expense" : "income"}
                  sign
                  className="w-28 text-right"
                />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function Goals({ data }: { data: Dashboard }) {
  const L = useL();
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{L.dashboard.goals}</CardTitle>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label={L.nav.goals} onClick={() => useApp.getState().go("goals")}>
            <Target />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="gap-3">
        {data.goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{L.dashboard.noGoals}</p>
        ) : (
          data.goals.slice(0, 4).map((g) => (
            <div key={g.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-sm">
                <IconBadge icon={g.icon} color={g.color} size="sm" />
                <span className="min-w-0 flex-1 truncate">{g.name}</span>
                <span className={cn("text-xs tabular", g.progress.overdue ? "text-expense" : "text-muted-foreground")}>
                  {formatPercent(g.progress.percentBp)}
                </span>
              </div>
              <ProgressBar bp={g.progress.percentBp} status={g.progress.percentBp >= 10_000 ? "done" : "ok"} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
