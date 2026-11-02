import { CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { IconBadge } from "@/components/common/icons";
import { Page, PageHeader, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { PeriodPicker } from "@/components/common/period-picker";
import { AccountSelect, MemberSelect, SimpleSelect } from "@/components/common/pickers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BalanceChart, CategoryBars, IncomeExpenseChart } from "@/features/analytics/charts";
import { fmt, useL } from "@/i18n";
import { type Period, monthLabel, periodFor, shiftMonth } from "@/lib/dates";
import { toLookups } from "@/lib/lookups";
import { useAccounts, useAnalytics, useCategories, useMembers } from "@/lib/queries";
import type { AnalyticsFilter, TxKind } from "@/lib/types";
import { useApp, useWorkspace } from "@/store/app";

const ALL = "__all";

export function AnalyticsPage() {
  const L = useL();
  const workspace = useWorkspace();
  const [period, setPeriod] = useState<Period>(() => periodFor("year"));
  const [accountId, setAccountId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>(ALL);

  const filter: AnalyticsFilter = useMemo(
    () => ({
      from: period.from,
      to: period.to,
      accountId: accountId ?? undefined,
      memberId: memberId ?? undefined,
      currency: currency === ALL ? undefined : currency,
    }),
    [period, accountId, memberId, currency],
  );
  const { data, isLoading } = useAnalytics(filter);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const lookups = useMemo(() => toLookups(accounts, categories, members), [accounts, categories, members]);
  const currencies = [...new Set(accounts.map((a) => a.currency))].sort();

  const drill = (kinds: TxKind[]) => (categoryId: string | null) =>
    useApp.getState().openOperations({
      from: period.from,
      to: period.to,
      categoryId: categoryId ?? undefined,
      accountId: accountId ?? undefined,
      memberId: memberId ?? undefined,
      kinds,
      status: "posted",
    });

  return (
    <Page>
      <PageHeader title={L.analytics.title} />
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <div className="w-52">
          <AccountSelect accounts={accounts} value={accountId} onChange={setAccountId} allowNone={L.transactions.allAccounts} />
        </div>
        {workspace.kind === "family" && (
          <div className="w-44">
            <MemberSelect members={members} value={memberId} onChange={setMemberId} allowNone={L.transactions.allMembers} />
          </div>
        )}
        {currencies.length > 1 && (
          <div className="w-36">
            <SimpleSelect
              aria-label={L.common.currency}
              value={currency}
              onChange={setCurrency}
              options={[{ value: ALL, label: L.analytics.allCurrencies }, ...currencies.map((c) => ({ value: c, label: c }))]}
            />
          </div>
        )}
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-96" />
      ) : (
        <>
          {data.missingRates.length > 0 && (
            <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              <CircleAlert className="size-4 text-warning" />
              {fmt(L.dashboard.missingRates, { list: data.missingRates.join(", ") })}
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <TotalCard label={L.dashboard.income}>
              <Money amount={data.totals.income} currency={data.currency} tone="income" sign />
            </TotalCard>
            <TotalCard label={L.dashboard.expense}>
              <Money amount={-data.totals.expense} currency={data.currency} tone="expense" />
            </TotalCard>
            <TotalCard label={L.dashboard.net}>
              <Money amount={data.totals.net} currency={data.currency} sign />
            </TotalCard>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{L.analytics.byMonth}</CardTitle>
            </CardHeader>
            <CardContent>
              <IncomeExpenseChart data={data.byMonth} currency={data.currency} height={280} />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{L.analytics.expenseStructure}</CardTitle>
                <CardDescription>{L.analytics.clickHint}</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBars
                  items={data.expenseByCategory}
                  categories={lookups.categories}
                  currency={data.currency}
                  limit={10}
                  onSelect={drill(["expense", "refund"])}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{L.analytics.incomeStructure}</CardTitle>
                <CardDescription>{L.analytics.clickHint}</CardDescription>
              </CardHeader>
              <CardContent>
                <CategoryBars
                  items={data.incomeByCategory}
                  categories={lookups.categories}
                  currency={data.currency}
                  limit={10}
                  onSelect={drill(["income"])}
                />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{L.analytics.balance}</CardTitle>
                {data.balanceHistory.some((p) => p.incomplete) && (
                  <CardDescription>{L.analytics.incomplete}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <BalanceChart data={data.balanceHistory} currency={data.currency} name={L.analytics.balance} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{L.analytics.savings}</CardTitle>
              </CardHeader>
              <CardContent>
                <BalanceChart data={data.savingsHistory} currency={data.currency} name={L.analytics.savings} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{L.analytics.comparison}</CardTitle>
              <CardDescription>
                {fmt(L.analytics.comparisonHint, {
                  current: monthLabel(data.comparisonMonth),
                  previous: monthLabel(shiftMonth(data.comparisonMonth, -1)),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.categoryComparison.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">{L.analytics.noData}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-medium">{L.txForm.category}</th>
                      <th className="py-1.5 text-right font-medium">{L.analytics.previous}</th>
                      <th className="py-1.5 text-right font-medium">{L.analytics.current}</th>
                      <th className="py-1.5 text-right font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...data.categoryComparison]
                      .sort((a, b) => b.current - a.current)
                      .map((row) => {
                        const c = row.categoryId ? lookups.categories.get(row.categoryId) : undefined;
                        const delta = row.current - row.previous;
                        return (
                          <tr key={row.categoryId ?? "none"}>
                            <td className="py-1.5">
                              <span className="flex items-center gap-2">
                                <IconBadge icon={c?.icon ?? "ellipsis"} color={c?.color ?? "#94a3b8"} size="sm" />
                                {c?.name ?? L.common.feesAndOther}
                              </span>
                            </td>
                            <td className="py-1.5 text-right">
                              <Money amount={row.previous} currency={data.currency} tone="muted" />
                            </td>
                            <td className="py-1.5 text-right">
                              <Money amount={row.current} currency={data.currency} />
                            </td>
                            <td className="py-1.5 text-right">
                              {/* more spending is the "bad" direction for expenses */}
                              <Money
                                amount={delta}
                                currency={data.currency}
                                sign
                                tone={delta > 0 ? "expense" : delta < 0 ? "income" : "muted"}
                              />
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </Page>
  );
}

function TotalCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="gap-1">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{children}</div>
      </CardContent>
    </Card>
  );
}
