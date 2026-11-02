import { CopyPlus, Ellipsis, ListFilter, Pencil, PiggyBank, Plus, Trash2, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { AmountInput } from "@/components/common/amount-input";
import { IconBadge } from "@/components/common/icons";
import { EmptyState, Field, Page, PageHeader, ProgressBar, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { MonthStepper } from "@/components/common/period-picker";
import { CategorySelect } from "@/components/common/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { currentMonth, monthRange } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { useBudget, useCategories, useWsMutation } from "@/lib/queries";
import type { BudgetView, LimitView } from "@/lib/types";
import { useApp } from "@/store/app";

type Editor = { kind: "total" } | { kind: "limit"; categoryId: string | null; limit: number | null } | null;

export function BudgetsPage() {
  const L = useL();
  const [month, setMonth] = useState(currentMonth);
  const [editor, setEditor] = useState<Editor>(null);
  const { data, isLoading } = useBudget(month);
  const { data: categories = [] } = useCategories();
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const copy = useWsMutation((workspaceId, m: string) => api.copyPreviousBudget({ workspaceId, month: m }), {
    success: L.budgets.copied,
  });
  const removeLimit = useWsMutation((workspaceId, categoryId: string) =>
    api.removeBudgetLimit({ workspaceId, month, categoryId }),
  );

  const empty = data && data.totalLimit === null && data.limits.length === 0;
  const drill = (categoryId: string) =>
    useApp.getState().openOperations({ ...monthRange(month), categoryId, kinds: ["expense", "refund"], status: "posted" });

  return (
    <Page>
      <PageHeader
        title={L.budgets.title}
        actions={
          <>
            <MonthStepper value={month} onChange={setMonth} />
            {empty && (
              <Button variant="outline" onClick={() => copy.mutate(month)} disabled={copy.isPending}>
                <CopyPlus />
                {L.budgets.copyPrevious}
              </Button>
            )}
          </>
        }
      />
      {isLoading || !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <TotalCard data={data} onEdit={() => setEditor({ kind: "total" })} />
          <Card>
            <CardHeader>
              <CardTitle>{L.budgets.limits}</CardTitle>
              <CardAction>
                <Button size="sm" onClick={() => setEditor({ kind: "limit", categoryId: null, limit: null })}>
                  <Plus />
                  {L.budgets.addLimit}
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="gap-1">
              {data.limits.length === 0 ? (
                <EmptyState icon={PiggyBank} title={L.budgets.empty} text={L.budgets.emptyHint} />
              ) : (
                data.limits.map((limit) => {
                  const c = byId.get(limit.categoryId);
                  return (
                    <LimitRow
                      key={limit.id}
                      limit={limit}
                      currency={data.currency}
                      name={c?.name ?? "?"}
                      icon={c?.icon ?? "ellipsis"}
                      color={c?.color ?? "#94a3b8"}
                      onEdit={() => setEditor({ kind: "limit", categoryId: limit.categoryId, limit: limit.limit })}
                      onRemove={() => removeLimit.mutate(limit.categoryId)}
                      onOpen={() => drill(limit.categoryId)}
                    />
                  );
                })
              )}
              {data.limits.length > 0 && data.unbudgetedSpent > 0 && (
                <div className="flex items-center justify-between px-2 pt-3 text-sm text-muted-foreground">
                  <span>{L.budgets.unbudgeted}</span>
                  <Money amount={data.unbudgetedSpent} currency={data.currency} />
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <BudgetEditor
        editor={editor}
        month={month}
        data={data}
        usedCategories={new Set(data?.limits.map((l) => l.categoryId))}
        onClose={() => setEditor(null)}
      />
    </Page>
  );
}

function TotalCard({ data, onEdit }: { data: BudgetView; onEdit: () => void }) {
  const L = useL();
  const status = data.totalStatus ?? "ok";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{L.budgets.total}</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil />
            {data.totalLimit === null ? L.budgets.setTotal : L.common.edit}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="gap-3">
        <div className="grid grid-cols-4 gap-4">
          <Metric label={L.budgets.limit}>
            {data.totalLimit === null ? (
              <span className="text-muted-foreground">{L.budgets.noTotal}</span>
            ) : (
              <Money amount={data.totalLimit} currency={data.currency} />
            )}
          </Metric>
          <Metric label={L.budgets.spent}>
            <Money amount={data.totalSpent} currency={data.currency} />
          </Metric>
          <Metric label={data.totalRemaining !== null && data.totalRemaining < 0 ? L.budgets.over : L.budgets.left}>
            {data.totalRemaining === null ? (
              "—"
            ) : (
              <Money
                amount={Math.abs(data.totalRemaining)}
                currency={data.currency}
                tone={data.totalRemaining < 0 ? "expense" : "none"}
              />
            )}
          </Metric>
          <Metric label={L.budgets.forecast}>
            <Money
              amount={data.totalForecast}
              currency={data.currency}
              tone={data.totalLimit !== null && data.totalForecast > data.totalLimit ? "expense" : "none"}
            />
          </Metric>
        </div>
        {data.totalPercentBp !== null && (
          <div className="flex items-center gap-3">
            <ProgressBar bp={data.totalPercentBp} status={status} />
            <span className="w-16 text-right text-xs text-muted-foreground tabular">
              {formatPercent(data.totalPercentBp)}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold">{children}</span>
    </div>
  );
}

function LimitRow({
  limit,
  currency,
  name,
  icon,
  color,
  onEdit,
  onRemove,
  onOpen,
}: {
  limit: LimitView;
  currency: string;
  name: string;
  icon: string;
  color: string;
  onEdit: () => void;
  onRemove: () => void;
  onOpen: () => void;
}) {
  const L = useL();
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60" data-testid="limit-row">
      <IconBadge icon={icon} color={color} />
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-1.5 text-left outline-none" onClick={onEdit}>
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{name}</span>
          {limit.status === "warning" && (
            <Badge variant="outline" className="border-warning/40 text-warning">
              <TriangleAlert />
              {L.budgets.warning}
            </Badge>
          )}
          {limit.status === "over" && (
            <Badge variant="destructive">
              <TriangleAlert />
              {L.budgets.overLimit}
            </Badge>
          )}
          <span className="ml-auto text-sm tabular">
            <Money amount={limit.spent} currency={currency} />
            <span className="text-muted-foreground">
              {" / "}
              <Money amount={limit.limit} currency={currency} />
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ProgressBar bp={limit.percentBp} status={limit.status} />
          <span className="w-40 shrink-0 text-right text-xs text-muted-foreground">
            {limit.remaining >= 0 ? L.budgets.left : L.budgets.over}{" "}
            <Money amount={Math.abs(limit.remaining)} currency={currency} />
          </span>
        </div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={L.common.more}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            {L.common.edit}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpen}>
            <ListFilter />
            {L.accounts.operations}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            <Trash2 />
            {L.budgets.remove}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function BudgetEditor({
  editor,
  month,
  data,
  usedCategories,
  onClose,
}: {
  editor: Editor;
  month: string;
  data: BudgetView | undefined;
  usedCategories: Set<string>;
  onClose: () => void;
}) {
  return (
    <Dialog open={editor !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {editor && data && (
          <EditorForm editor={editor} month={month} data={data} usedCategories={usedCategories} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({
  editor,
  month,
  data,
  usedCategories,
  onClose,
}: {
  editor: NonNullable<Editor>;
  month: string;
  data: BudgetView;
  usedCategories: Set<string>;
  onClose: () => void;
}) {
  const L = useL();
  const { data: categories = [] } = useCategories();
  const [amount, setAmount] = useState<number | null>(editor.kind === "total" ? data.totalLimit : editor.limit);
  const [categoryId, setCategoryId] = useState<string | null>(editor.kind === "limit" ? editor.categoryId : null);
  const isNewLimit = editor.kind === "limit" && editor.categoryId === null;

  const save = useWsMutation(
    (workspaceId, _: void) =>
      editor.kind === "total"
        ? api.setBudgetTotal({ workspaceId, month, limit: amount })
        : api.setBudgetLimit({ workspaceId, month, input: { categoryId: categoryId ?? "", limit: amount ?? 0 } }),
    { success: L.common.saved, onSuccess: onClose },
  );

  // A total may be cleared (empty field); a category limit needs a positive amount
  const valid =
    editor.kind === "total" ? amount === null || amount > 0 : categoryId !== null && amount !== null && amount > 0;
  const available = categories.filter((c) => !usedCategories.has(c.id) || c.id === categoryId);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{editor.kind === "total" ? L.budgets.total : L.budgets.limitTitle}</DialogTitle>
      </DialogHeader>
      {editor.kind === "limit" && (
        <Field label={L.budgets.category} htmlFor="limit-category">
          {isNewLimit ? (
            <CategorySelect
              id="limit-category"
              categories={available}
              kind="expense"
              value={categoryId}
              placeholder={L.common.none}
              onChange={setCategoryId}
            />
          ) : (
            <span className="font-medium">{categories.find((c) => c.id === categoryId)?.name}</span>
          )}
        </Field>
      )}
      <Field
        label={L.budgets.limit}
        htmlFor="limit-amount"
        hint={editor.kind === "total" ? L.budgets.totalHint : undefined}
      >
        <AmountInput
          id="limit-amount"
          autoFocus
          currency={data.currency}
          value={amount}
          onValueChange={setAmount}
        />
      </Field>
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
