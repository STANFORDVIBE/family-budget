import { CalendarClock, Ellipsis, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { AmountInput } from "@/components/common/amount-input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconBadge } from "@/components/common/icons";
import { EmptyState, Field, Page, PageHeader, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { AccountSelect, CategorySelect, MemberSelect, SimpleSelect } from "@/components/common/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TransactionRow } from "@/features/transactions/TransactionRow";
import { fmt, useL } from "@/i18n";
import type { Dictionary } from "@/i18n/ru";
import { api } from "@/lib/api";
import { dayLabel, todayIso } from "@/lib/dates";
import { toLookups } from "@/lib/lookups";
import { useAccounts, useCategories, useMembers, useRecurring, useTransactions, useWsMutation } from "@/lib/queries";
import type { IntervalUnit, RecurringInput, RecurringRule } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/app";

function intervalText(L: Dictionary, unit: IntervalUnit, count: number): string {
  if (count === 1) return L.intervals[unit];
  const short = { day: L.intervals.unitDay, week: L.intervals.unitWeek, month: L.intervals.unitMonth, year: L.intervals.unitYear }[
    unit
  ];
  return `${L.intervals.every} ${count} ${short}`;
}

export function RecurringPage() {
  const L = useL();
  const { data: rules, isLoading } = useRecurring();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: pending } = useTransactions({ status: "pending", sort: "date_asc", limit: 200 });
  const lookups = useMemo(() => toLookups(accounts, categories, members), [accounts, categories, members]);
  const [editing, setEditing] = useState<RecurringRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<RecurringRule | null>(null);

  const pause = useWsMutation((workspaceId, a: { id: string; paused: boolean }) =>
    api.setRecurringPaused({ workspaceId, ...a }),
  );
  const remove = useWsMutation((workspaceId, id: string) => api.deleteRecurring({ workspaceId, id }), {
    success: L.common.deleted,
    onSuccess: () => setDeleting(null),
  });

  return (
    <Page>
      <PageHeader
        title={L.recurring.title}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {L.recurring.add}
          </Button>
        }
      />
      {pending && pending.items.length > 0 && (
        <Card size="sm" className="ring-warning/40">
          <CardHeader>
            <CardTitle>{L.recurring.pendingTitle}</CardTitle>
          </CardHeader>
          <CardContent className="gap-0">
            {pending.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} lookups={lookups} />
            ))}
          </CardContent>
        </Card>
      )}
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : !rules || rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarClock}
            title={L.recurring.empty}
            text={L.recurring.emptyHint}
            action={<Button onClick={() => setEditing("new")}>{L.recurring.add}</Button>}
          />
        </Card>
      ) : (
        <Card size="sm">
          <CardContent className="gap-0">
            {rules.map((rule) => {
              const c = lookups.categories.get(rule.categoryId);
              const account = lookups.accounts.get(rule.accountId);
              return (
                <div
                  key={rule.id}
                  className={cn("flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/60", rule.status !== "active" && "opacity-60")}
                  data-testid="recurring-row"
                >
                  <IconBadge icon={c?.icon ?? "repeat"} color={c?.color ?? "#64748b"} />
                  <button type="button" className="min-w-0 flex-1 text-left outline-none" onClick={() => setEditing(rule)}>
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{rule.name}</span>
                      {rule.status === "paused" && <Badge variant="secondary">{L.recurring.paused}</Badge>}
                      {rule.status === "finished" && <Badge variant="secondary">{L.recurring.finished}</Badge>}
                      {rule.pendingCount > 0 && (
                        <Badge variant="outline" className="border-warning/40 text-warning">
                          {fmt(L.recurring.pendingCount, { n: rule.pendingCount })}
                        </Badge>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {intervalText(L, rule.intervalUnit, rule.intervalCount)} · {account?.name ?? "?"}
                      {rule.status === "active" && ` · ${L.recurring.next}: ${dayLabel(rule.nextDate)}`}
                    </div>
                  </button>
                  <Money
                    amount={rule.kind === "expense" ? -rule.amount : rule.amount}
                    currency={rule.currency}
                    tone={rule.kind === "expense" ? "expense" : "income"}
                    sign
                    className="font-medium"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={L.common.more}>
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem onSelect={() => setEditing(rule)}>
                        <Pencil />
                        {L.common.edit}
                      </DropdownMenuItem>
                      {rule.status !== "finished" && (
                        <DropdownMenuItem
                          onSelect={() => pause.mutate({ id: rule.id, paused: rule.status === "active" })}
                        >
                          {rule.status === "active" ? <Pause /> : <Play />}
                          {rule.status === "active" ? L.recurring.pause : L.recurring.resume}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(rule)}>
                        <Trash2 />
                        {L.common.delete}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing !== null && (
            <RecurringForm key={editing === "new" ? "new" : editing.id} rule={editing} onClose={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={L.recurring.deleteTitle}
        text={L.recurring.deleteText}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Page>
  );
}

type Repeat = IntervalUnit | "custom";

function RecurringForm({ rule, onClose }: { rule: RecurringRule | "new"; onClose: () => void }) {
  const L = useL();
  const workspace = useWorkspace();
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const existing = rule === "new" ? null : rule;
  const [form, setForm] = useState<Omit<RecurringInput, "amount"> & { amount: number | null }>(() =>
    existing
      ? {
          name: existing.name,
          kind: existing.kind,
          amount: existing.amount,
          accountId: existing.accountId,
          categoryId: existing.categoryId,
          memberId: existing.memberId,
          comment: existing.comment,
          intervalUnit: existing.intervalUnit,
          intervalCount: existing.intervalCount,
          startDate: existing.startDate,
          endDate: existing.endDate,
        }
      : {
          id: crypto.randomUUID(),
          name: "",
          kind: "expense",
          amount: null,
          accountId: accounts.find((a) => a.isActive)?.id ?? "",
          categoryId: "",
          memberId: null,
          comment: null,
          intervalUnit: "month",
          intervalCount: 1,
          startDate: todayIso(),
          endDate: null,
        },
  );
  const [repeat, setRepeat] = useState<Repeat>(existing && existing.intervalCount !== 1 ? "custom" : (existing?.intervalUnit ?? "month"));
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const currency = accounts.find((a) => a.id === form.accountId)?.currency ?? workspace.baseCurrency;

  const save = useWsMutation(
    (workspaceId, input: RecurringInput) =>
      existing ? api.updateRecurring({ workspaceId, id: existing.id, input }) : api.createRecurring({ workspaceId, input }),
    { success: L.common.saved, onSuccess: onClose },
  );

  const valid =
    form.name.trim() !== "" &&
    form.amount !== null &&
    form.amount > 0 &&
    form.accountId !== "" &&
    form.categoryId !== "" &&
    form.intervalCount >= 1 &&
    form.intervalCount <= 1000 &&
    (!form.endDate || form.endDate >= form.startDate);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && form.amount !== null)
          save.mutate({ ...form, amount: form.amount, name: form.name.trim(), comment: form.comment?.trim() || null });
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? L.recurring.editTitle : L.recurring.createTitle}</DialogTitle>
      </DialogHeader>
      <SegmentedControl
        aria-label={L.recurring.kind}
        className="w-full [&>*]:flex-1 [&>*]:justify-center"
        value={form.kind}
        options={[
          { value: "expense", label: L.kinds.expense },
          { value: "income", label: L.kinds.income },
        ]}
        onValueChange={(kind) => set({ kind, categoryId: "" })}
      />
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.recurring.name} htmlFor="rr-name" className="col-span-2">
          <Input
            id="rr-name"
            autoFocus
            maxLength={60}
            placeholder={L.recurring.namePlaceholder}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label={L.recurring.amount} htmlFor="rr-amount">
          <AmountInput id="rr-amount" currency={currency} value={form.amount} onValueChange={(amount) => set({ amount })} />
        </Field>
        <Field label={L.recurring.account} htmlFor="rr-account">
          <AccountSelect
            id="rr-account"
            accounts={accounts}
            value={form.accountId || null}
            onChange={(id) => set({ accountId: id ?? "" })}
          />
        </Field>
        <Field label={L.recurring.category} htmlFor="rr-category" className={workspace.kind === "family" ? undefined : "col-span-2"}>
          <CategorySelect
            id="rr-category"
            categories={categories}
            kind={form.kind}
            value={form.categoryId || null}
            placeholder={L.common.none}
            onChange={(id) => set({ categoryId: id ?? "" })}
          />
        </Field>
        {workspace.kind === "family" && (
          <Field label={L.txForm.member} htmlFor="rr-member">
            <MemberSelect
              id="rr-member"
              members={members}
              value={form.memberId}
              allowNone={L.common.none}
              onChange={(memberId) => set({ memberId })}
            />
          </Field>
        )}
        <Field label={L.recurring.interval} htmlFor="rr-interval" className={repeat === "custom" ? undefined : "col-span-2"}>
          <SimpleSelect
            id="rr-interval"
            value={repeat}
            onChange={(value) => {
              setRepeat(value);
              if (value !== "custom") set({ intervalUnit: value, intervalCount: 1 });
            }}
            options={(["day", "week", "month", "year", "custom"] as const).map((v) => ({ value: v, label: L.intervals[v] }))}
          />
        </Field>
        {repeat === "custom" && (
          <div className="flex items-end gap-2">
            <Field label={L.intervals.every} htmlFor="rr-count" className="w-20">
              <Input
                id="rr-count"
                type="number"
                min={1}
                max={1000}
                value={form.intervalCount}
                onChange={(e) => set({ intervalCount: Math.trunc(Number(e.target.value)) || 1 })}
              />
            </Field>
            <SimpleSelect
              aria-label={L.recurring.interval}
              className="flex-1"
              value={form.intervalUnit}
              onChange={(intervalUnit) => set({ intervalUnit })}
              options={[
                { value: "day", label: L.intervals.unitDay },
                { value: "week", label: L.intervals.unitWeek },
                { value: "month", label: L.intervals.unitMonth },
                { value: "year", label: L.intervals.unitYear },
              ]}
            />
          </div>
        )}
        <Field label={L.recurring.start} htmlFor="rr-start">
          <Input id="rr-start" type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label={L.recurring.end} htmlFor="rr-end" hint={form.endDate ? undefined : L.recurring.noEnd}>
          <Input
            id="rr-end"
            type="date"
            min={form.startDate}
            value={form.endDate ?? ""}
            onChange={(e) => set({ endDate: e.target.value || null })}
          />
        </Field>
        <Field label={L.txForm.comment} htmlFor="rr-comment" className="col-span-2">
          <Input
            id="rr-comment"
            maxLength={500}
            value={form.comment ?? ""}
            onChange={(e) => set({ comment: e.target.value })}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {L.common.cancel}
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          {L.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
