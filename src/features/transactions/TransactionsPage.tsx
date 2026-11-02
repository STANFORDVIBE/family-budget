import { Download, FilterX, Receipt, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Page, PageHeader, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { PeriodPicker } from "@/components/common/period-picker";
import { AccountSelect, CategorySelect, MemberSelect, SimpleSelect } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HistoryDialog } from "@/features/audit/AuditList";
import { TransactionRow } from "@/features/transactions/TransactionRow";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { type Period, dayLabel, periodFor } from "@/lib/dates";
import { toLookups } from "@/lib/lookups";
import { useAccounts, useCategories, useMembers, useTransactions, useWsMutation } from "@/lib/queries";
import type { Transaction, TransactionFilter, TxKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp, useWorkspace } from "@/store/app";

const PAGE = 100;
type KindFilter = TxKind | "all";
type StatusFilter = NonNullable<TransactionFilter["status"]>;
type SortFilter = NonNullable<TransactionFilter["sort"]>;

export function TransactionsPage() {
  const L = useL();
  const workspace = useWorkspace();
  const searchTick = useApp((s) => s.searchFocusTick);
  const searchRef = useRef<HTMLInputElement>(null);

  // A drill-down from another screen (analytics, accounts, budgets) arrives as a preset filter.
  // It is read once for the initial state and cleared right after.
  const [preset] = useState(() => useApp.getState().operationsPreset);
  useEffect(() => {
    if (preset) useApp.getState().consumePreset();
  }, [preset]);

  const [period, setPeriod] = useState<Period>(() =>
    preset?.from && preset.to ? { kind: "custom", from: preset.from, to: preset.to } : periodFor("month"),
  );
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState<KindFilter>(() => (preset?.kinds?.length === 1 ? (preset.kinds[0] ?? "all") : "all"));
  const [accountId, setAccountId] = useState<string | null>(preset?.accountId ?? null);
  const [categoryId, setCategoryId] = useState<string | null>(preset?.categoryId ?? null);
  const [memberId, setMemberId] = useState<string | null>(preset?.memberId ?? null);
  const [status, setStatus] = useState<StatusFilter>(preset?.status ?? "all");
  const [sort, setSort] = useState<SortFilter>("date_desc");
  const [limit, setLimit] = useState(PAGE);
  const [historyId, setHistoryId] = useState<string | null>(null);

  useEffect(() => {
    if (searchTick > 0) searchRef.current?.focus();
  }, [searchTick]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filter: TransactionFilter = useMemo(
    () => ({
      from: period.from,
      to: period.to,
      kinds: kind === "all" ? undefined : [kind],
      accountId: accountId ?? undefined,
      categoryId: categoryId ?? undefined,
      memberId: memberId ?? undefined,
      search: debounced || undefined,
      status,
      sort,
      limit,
      offset: 0,
    }),
    [period, kind, accountId, categoryId, memberId, debounced, status, sort, limit],
  );

  const { data, isLoading } = useTransactions(filter);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const lookups = useMemo(() => toLookups(accounts, categories, members), [accounts, categories, members]);

  const exportCsv = useWsMutation(
    (workspaceId, f: TransactionFilter) =>
      api.exportTransactionsCsv({ workspaceId, filter: { ...f, limit: undefined, offset: undefined } }),
    { success: (name) => fmt(L.transactions.exported, { name }) },
  );

  const filtered = kind !== "all" || accountId || categoryId || memberId || status !== "all" || search;
  function reset() {
    setSearch("");
    setKind("all");
    setAccountId(null);
    setCategoryId(null);
    setMemberId(null);
    setStatus("all");
  }

  const groups = useMemo(
    () => groupByDate(data?.items ?? [], sort, workspace.baseCurrency),
    [data, sort, workspace.baseCurrency],
  );

  const kindOptions = [
    { value: "all" as const, label: L.transactions.allKinds },
    ...(["expense", "income", "transfer", "refund", "adjustment"] as const).map((k) => ({ value: k, label: L.kinds[k] })),
  ];

  return (
    <Page>
      <PageHeader
        title={L.transactions.title}
        description={data ? fmt(L.transactions.found, { n: data.total }) : undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => exportCsv.mutate(filter)} disabled={exportCsv.isPending}>
              <Download />
              {L.transactions.export}
            </Button>
            <Button onClick={() => useApp.getState().openTxDialog({ mode: "create" })}>{L.transactions.add}</Button>
          </>
        }
      />

      <Card size="sm">
        <CardContent className="gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <PeriodPicker value={period} onChange={setPeriod} />
            <div className="relative min-w-60 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                type="search"
                className="pl-8"
                placeholder={L.transactions.searchPlaceholder}
                aria-label={L.common.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className={cn("grid grid-cols-2 gap-2", workspace.kind === "family" ? "lg:grid-cols-6" : "lg:grid-cols-5")}>
            <SimpleSelect aria-label={L.transactions.allKinds} value={kind} options={kindOptions} onChange={setKind} />
            <AccountSelect
              accounts={accounts}
              value={accountId}
              onChange={setAccountId}
              allowNone={L.transactions.allAccounts}
            />
            <CategorySelect
              categories={categories}
              kind={kind === "income" ? "income" : "expense"}
              value={categoryId}
              onChange={setCategoryId}
              allowNone={L.transactions.allCategories}
            />
            {workspace.kind === "family" ? (
              <MemberSelect members={members} value={memberId} onChange={setMemberId} allowNone={L.transactions.allMembers} />
            ) : null}
            <SimpleSelect
              aria-label={L.common.status}
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: L.common.all },
                { value: "posted", label: L.transactions.statusPosted },
                { value: "pending", label: L.transactions.statusPending },
              ]}
            />
            <SimpleSelect
              aria-label={L.transactions.sortDateDesc}
              value={sort}
              onChange={setSort}
              options={[
                { value: "date_desc", label: L.transactions.sortDateDesc },
                { value: "date_asc", label: L.transactions.sortDateAsc },
                { value: "amount_desc", label: L.transactions.sortAmountDesc },
                { value: "amount_asc", label: L.transactions.sortAmountAsc },
              ]}
            />
          </div>
          {filtered && (
            <div>
              <Button variant="ghost" size="sm" onClick={reset}>
                <FilterX />
                {L.transactions.reset}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="gap-0">
          {isLoading ? (
            <div className="flex flex-col gap-2 py-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-11" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <EmptyState icon={Receipt} title={L.transactions.empty} text={L.transactions.emptyHint} />
          ) : (
            groups.map((group) => (
              <section key={group.key} className="py-1">
                {group.date && (
                  <div className="flex items-center justify-between px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">
                    <span>{dayLabel(group.date)}</span>
                    {group.net !== null && (
                      <Money amount={group.net} currency={workspace.baseCurrency} sign tone="muted" />
                    )}
                  </div>
                )}
                {group.items.map((tx) => (
                  <TransactionRow key={tx.id} tx={tx} lookups={lookups} onHistory={(t) => setHistoryId(t.id)} />
                ))}
              </section>
            ))
          )}
          {data && data.items.length < data.total && (
            <div className="flex justify-center pt-3">
              <Button variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                {L.transactions.loadMore}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <HistoryDialog entityId={historyId} onClose={() => setHistoryId(null)} />
    </Page>
  );
}

interface Group {
  key: string;
  date: string | null;
  /** Day result in the base currency (income minus expenses), when every amount has a base value. */
  net: number | null;
  items: Transaction[];
}

function groupByDate(items: Transaction[], sort: SortFilter, baseCurrency: string): Group[] {
  if (sort === "amount_desc" || sort === "amount_asc") return items.length ? [{ key: "all", date: null, net: null, items }] : [];
  const groups: Group[] = [];
  for (const tx of items) {
    let group = groups[groups.length - 1];
    if (!group || group.date !== tx.date) {
      group = { key: tx.date, date: tx.date, net: 0, items: [] };
      groups.push(group);
    }
    group.items.push(tx);
    if (tx.status !== "posted" || group.net === null) continue;
    if (tx.kind === "transfer") {
      // Only the fee is spending; it is known in the base currency when the account is in it
      if (tx.fee > 0) group.net = tx.currency === baseCurrency ? group.net - tx.fee : null;
    } else if (tx.kind !== "adjustment") {
      group.net = tx.baseAmount === null ? null : group.net + tx.baseAmount;
    }
  }
  return groups;
}
