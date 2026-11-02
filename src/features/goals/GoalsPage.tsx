import { Archive, ArchiveRestore, CircleCheck, Ellipsis, History, Minus, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useState } from "react";
import { AmountInput } from "@/components/common/amount-input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconBadge } from "@/components/common/icons";
import { EmptyState, Field, Page, PageHeader, ProgressBar, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { AccountSelect, ColorPicker, CurrencySelect, IconPicker } from "@/components/common/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { dayLabel, todayIso } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { useAccounts, useContributions, useGoals, useWsMutation } from "@/lib/queries";
import type { Goal, GoalInput, GoalStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp, useWorkspace } from "@/store/app";

export function GoalsPage() {
  const L = useL();
  const { data: goals, isLoading } = useGoals();
  const [editing, setEditing] = useState<Goal | "new" | null>(null);
  const [moving, setMoving] = useState<{ goal: Goal; direction: 1 | -1 } | null>(null);
  const [history, setHistory] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState<Goal | null>(null);

  // "New goal" from the quick actions menu
  const intent = useApp((s) => s.createIntent);
  const dialogGoal = editing ?? (intent === "goal" ? "new" : null);
  function closeEditor() {
    if (intent === "goal") useApp.getState().consumeCreate();
    setEditing(null);
  }

  const setStatus = useWsMutation((workspaceId, a: { id: string; status: GoalStatus }) =>
    api.setGoalStatus({ workspaceId, ...a }),
  );
  const remove = useWsMutation((workspaceId, id: string) => api.deleteGoal({ workspaceId, id }), {
    success: L.common.deleted,
    onSuccess: () => setDeleting(null),
  });

  const order: Record<GoalStatus, number> = { active: 0, achieved: 1, archived: 2 };
  const sorted = [...(goals ?? [])].sort((a, b) => order[a.status] - order[b.status]);

  return (
    <Page>
      <PageHeader
        title={L.goals.title}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {L.goals.add}
          </Button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : sorted.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title={L.goals.empty}
            text={L.goals.emptyHint}
            action={<Button onClick={() => setEditing("new")}>{L.goals.add}</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {sorted.map((goal) => {
            const p = goal.progress;
            const done = p.percentBp >= 10_000;
            return (
              <Card key={goal.id} size="sm" className={cn(goal.status === "archived" && "opacity-60")} data-testid="goal-card">
                <CardContent className="gap-3">
                  <div className="flex items-start gap-3">
                    <IconBadge icon={goal.icon} color={goal.color} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{goal.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {goal.targetDate ? dayLabel(goal.targetDate) : goal.currency}
                      </div>
                    </div>
                    {goal.status === "achieved" && <Badge className="bg-success text-white">{L.goals.achieved}</Badge>}
                    {goal.status === "archived" && <Badge variant="secondary">{L.goals.archived}</Badge>}
                    {goal.status === "active" && p.overdue && <Badge variant="destructive">{L.goals.overdue}</Badge>}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={L.common.more}>
                          <Ellipsis />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onSelect={() => setEditing(goal)}>
                          <Pencil />
                          {L.common.edit}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setHistory(goal)}>
                          <History />
                          {L.goals.history}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {goal.status === "active" ? (
                          <DropdownMenuItem onSelect={() => setStatus.mutate({ id: goal.id, status: "achieved" })}>
                            <CircleCheck />
                            {L.goals.markAchieved}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onSelect={() => setStatus.mutate({ id: goal.id, status: "active" })}>
                            <ArchiveRestore />
                            {L.goals.reactivate}
                          </DropdownMenuItem>
                        )}
                        {goal.status !== "archived" && (
                          <DropdownMenuItem onSelect={() => setStatus.mutate({ id: goal.id, status: "archived" })}>
                            <Archive />
                            {L.common.archive}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(goal)}>
                          <Trash2 />
                          {L.common.delete}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="flex items-end justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted-foreground">{L.goals.saved}</div>
                      <Money amount={p.current} currency={goal.currency} className="text-lg font-semibold" />
                      <span className="text-sm text-muted-foreground">
                        {" / "}
                        <Money amount={goal.target} currency={goal.currency} />
                      </span>
                    </div>
                    <span className="text-sm font-medium tabular">{formatPercent(p.percentBp)}</span>
                  </div>
                  <ProgressBar bp={p.percentBp} status={done ? "done" : p.overdue ? "warning" : "ok"} />
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {L.goals.left}: <Money amount={p.remaining} currency={goal.currency} />
                    </span>
                    {p.monthlyNeeded !== null && p.remaining > 0 && (
                      <span>
                        {L.goals.monthly}: <Money amount={p.monthlyNeeded} currency={goal.currency} />
                      </span>
                    )}
                  </div>
                  {goal.status === "active" && (
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1" onClick={() => setMoving({ goal, direction: 1 })}>
                        <Plus />
                        {L.goals.contribute}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={p.current <= 0}
                        onClick={() => setMoving({ goal, direction: -1 })}
                      >
                        <Minus />
                        {L.goals.withdraw}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogGoal !== null} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-lg">
          {dialogGoal !== null && (
            <GoalForm key={dialogGoal === "new" ? "new" : dialogGoal.id} goal={dialogGoal} onClose={closeEditor} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <DialogContent>
          {moving && <ContributionForm goal={moving.goal} direction={moving.direction} onClose={() => setMoving(null)} />}
        </DialogContent>
      </Dialog>
      <ContributionHistory goal={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={L.goals.deleteTitle}
        text={L.goals.deleteText}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Page>
  );
}

function GoalForm({ goal, onClose }: { goal: Goal | "new"; onClose: () => void }) {
  const L = useL();
  const workspace = useWorkspace();
  const { data: accounts = [] } = useAccounts();
  const existing = goal === "new" ? null : goal;
  const [form, setForm] = useState<Omit<GoalInput, "target"> & { target: number | null }>(() =>
    existing
      ? {
          name: existing.name,
          target: existing.target,
          currency: existing.currency,
          targetDate: existing.targetDate,
          accountId: existing.accountId,
          description: existing.description,
          icon: existing.icon,
          color: existing.color,
        }
      : {
          id: crypto.randomUUID(),
          name: "",
          target: null,
          currency: workspace.baseCurrency,
          targetDate: null,
          accountId: null,
          description: null,
          icon: "target",
          color: "#0f7c74",
        },
  );
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const save = useWsMutation(
    (workspaceId, input: GoalInput) =>
      existing ? api.updateGoal({ workspaceId, id: existing.id, input }) : api.createGoal({ workspaceId, input }),
    { success: L.common.saved, onSuccess: onClose },
  );
  // The storage account must be in the goal currency, otherwise contributions cannot be transfers
  const storage = accounts.filter((a) => a.currency === form.currency);
  const valid = form.name.trim() !== "" && form.target !== null && form.target > 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && form.target !== null)
          save.mutate({
            ...form,
            target: form.target,
            name: form.name.trim(),
            description: form.description?.trim() || null,
          });
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? L.goals.editTitle : L.goals.createTitle}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.goals.name} htmlFor="goal-name" className="col-span-2">
          <Input
            id="goal-name"
            autoFocus
            maxLength={60}
            placeholder={L.goals.namePlaceholder}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label={L.goals.target} htmlFor="goal-target">
          <AmountInput id="goal-target" currency={form.currency} value={form.target} onValueChange={(target) => set({ target })} />
        </Field>
        <Field label={L.goals.currency} htmlFor="goal-currency">
          <CurrencySelect
            id="goal-currency"
            value={form.currency}
            onChange={(currency) => set({ currency, accountId: null })}
          />
        </Field>
        <Field label={L.goals.date} htmlFor="goal-date">
          <Input
            id="goal-date"
            type="date"
            min={todayIso()}
            value={form.targetDate ?? ""}
            onChange={(e) => set({ targetDate: e.target.value || null })}
          />
        </Field>
        <Field label={L.goals.account} htmlFor="goal-account" hint={L.goals.accountHint}>
          <AccountSelect
            id="goal-account"
            accounts={storage}
            value={form.accountId}
            allowNone={L.goals.noAccount}
            onChange={(accountId) => set({ accountId })}
          />
        </Field>
        <Field label={L.goals.description} htmlFor="goal-description" className="col-span-2">
          <Textarea
            id="goal-description"
            rows={2}
            maxLength={500}
            value={form.description ?? ""}
            onChange={(e) => set({ description: e.target.value })}
          />
        </Field>
        <Field label={L.common.color} className="col-span-2">
          <ColorPicker value={form.color} onChange={(color) => set({ color })} />
        </Field>
        <Field label={L.common.icon} className="col-span-2">
          <IconPicker value={form.icon} color={form.color} onChange={(icon) => set({ icon })} />
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

function ContributionForm({ goal, direction, onClose }: { goal: Goal; direction: 1 | -1; onClose: () => void }) {
  const L = useL();
  const { data: accounts = [] } = useAccounts();
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso);
  // Without a storage account a contribution can only be a mark
  const [accountId, setAccountId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [id] = useState(() => crypto.randomUUID());
  const sources = accounts.filter((a) => a.currency === goal.currency && a.id !== goal.accountId);

  const save = useWsMutation(
    (workspaceId, _: void) =>
      api.contribute({
        workspaceId,
        goalId: goal.id,
        input: { id, amount: (amount ?? 0) * direction, date, accountId, comment: comment.trim() || null },
      }),
    { success: L.goals.contributed, onSuccess: onClose },
  );
  const max = direction === -1 ? goal.progress.current : Infinity;
  const valid = amount !== null && amount > 0 && amount <= max && date !== "";

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{direction === 1 ? L.goals.contributeTitle : L.goals.withdrawTitle}</DialogTitle>
        <DialogDescription>
          {goal.name} · {L.goals.contributionHint}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.common.amount} htmlFor="gc-amount">
          <AmountInput id="gc-amount" autoFocus currency={goal.currency} value={amount} onValueChange={setAmount} />
        </Field>
        <Field label={L.common.date} htmlFor="gc-date">
          <Input id="gc-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {goal.accountId && (
          <Field
            label={direction === 1 ? L.goals.contributionAccount : L.goals.withdrawAccount}
            htmlFor="gc-account"
            className="col-span-2"
          >
            <AccountSelect
              id="gc-account"
              accounts={sources}
              value={accountId}
              allowNone={L.goals.justMark}
              onChange={setAccountId}
            />
          </Field>
        )}
        <Field label={L.common.comment} htmlFor="gc-comment" className="col-span-2">
          <Input id="gc-comment" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {L.common.cancel}
        </Button>
        <Button type="submit" disabled={!valid || save.isPending}>
          {direction === 1 ? L.goals.contribute : L.goals.withdraw}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ContributionHistory({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const L = useL();
  const { data = [] } = useContributions(goal?.id ?? null);
  const remove = useWsMutation((workspaceId, id: string) => api.deleteContribution({ workspaceId, id }), {
    success: L.common.deleted,
  });
  return (
    <Dialog open={goal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{L.goals.history}</DialogTitle>
          {goal && <DialogDescription>{goal.name}</DialogDescription>}
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          {data.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">{L.goals.noHistory}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.map((c) => (
                <li key={c.id} className="group flex items-center gap-3 py-2 text-sm">
                  <span className="w-24 shrink-0 text-muted-foreground">{dayLabel(c.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {[c.transactionId ? L.goals.viaTransfer : null, c.comment].filter(Boolean).join(" · ")}
                  </span>
                  {goal && <Money amount={c.amount} currency={goal.currency} sign tone="auto" />}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={L.common.delete}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    onClick={() => remove.mutate(c.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {goal && goal.progress.monthsLeft !== null && (
          <p className="text-xs text-muted-foreground">{fmt(L.goals.monthsLeft, { n: goal.progress.monthsLeft })}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
