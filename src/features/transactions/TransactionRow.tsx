import { ArrowLeftRight, CalendarClock, Copy, Ellipsis, History, Pencil, Scale, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { IconBadge } from "@/components/common/icons";
import { Money } from "@/components/common/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { useWsMutation } from "@/lib/queries";
import type { Lookups } from "@/lib/lookups";
import type { Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

/** One operation in a list: icon, title, account, amount, and an actions menu. */
export function TransactionRow({
  tx,
  lookups,
  onHistory,
  compact = false,
}: {
  tx: Transaction;
  lookups: Lookups;
  onHistory?: (tx: Transaction) => void;
  compact?: boolean;
}) {
  const L = useL();
  const open = useApp((s) => s.openTxDialog);
  const account = lookups.accounts.get(tx.accountId);
  const toAccount = tx.toAccountId ? lookups.accounts.get(tx.toAccountId) : undefined;
  const category = tx.categoryId ? lookups.categories.get(tx.categoryId) : undefined;
  const member = tx.memberId ? lookups.members.get(tx.memberId) : undefined;
  const pending = tx.status === "pending";

  const restore = useWsMutation((workspaceId, id: string) => api.restoreTransaction({ workspaceId, id }), {
    success: L.transactions.restoredToast,
  });
  const remove = useWsMutation((workspaceId, id: string) => api.deleteTransaction({ workspaceId, id }), {
    onSuccess: () =>
      toast(L.transactions.deletedToast, {
        action: { label: L.common.undo, onClick: () => restore.mutate(tx.id) },
      }),
  });

  const title =
    tx.kind === "transfer"
      ? `${account?.name ?? "?"} → ${toAccount?.name ?? "?"}`
      : tx.kind === "adjustment"
        ? L.kinds.adjustment
        : (category?.name ?? (tx.kind === "refund" ? L.kinds.refund : L.common.noCategory));

  const subtitle = [
    tx.kind === "refund" ? L.kinds.refund : null,
    tx.kind !== "transfer" ? account?.name : null,
    member?.name,
    tx.comment,
  ]
    .filter(Boolean)
    .join(" · ");

  const badge =
    tx.kind === "transfer" ? (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ArrowLeftRight className="size-4" />
      </span>
    ) : tx.kind === "adjustment" ? (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Scale className="size-4" />
      </span>
    ) : category ? (
      <IconBadge icon={category.icon} color={category.color} />
    ) : (
      <IconBadge icon="ellipsis" color="#94a3b8" />
    );

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60",
        pending && "bg-warning/5",
      )}
      data-testid="tx-row"
    >
      {badge}
      <button
        type="button"
        className="min-w-0 flex-1 text-left outline-none"
        onClick={() => open({ mode: pending ? "confirm" : "edit", transaction: tx })}
      >
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          {pending && (
            <Badge variant="outline" className="border-warning/40 text-warning">
              <CalendarClock />
              {L.transactions.pendingBadge}
            </Badge>
          )}
        </div>
        {!compact && subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </button>
      <div className="flex flex-col items-end">
        <Money
          amount={tx.kind === "transfer" ? -Math.abs(tx.amount) : tx.amount}
          currency={tx.currency}
          tone={tx.kind === "transfer" || tx.kind === "adjustment" ? "none" : "auto"}
          sign
          className={cn("font-medium", pending && "opacity-70")}
        />
        {tx.kind === "transfer" && tx.toAmount !== null && tx.toCurrency && tx.toCurrency !== tx.currency && (
          <Money amount={tx.toAmount} currency={tx.toCurrency} sign tone="muted" className="text-xs" />
        )}
        {tx.fee > 0 && (
          <span className="text-xs text-muted-foreground">
            {L.transactions.feeLabel} <Money amount={tx.fee} currency={tx.currency} />
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={L.common.more}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {pending ? (
            <DropdownMenuItem onSelect={() => open({ mode: "confirm", transaction: tx })}>
              <CalendarClock />
              {L.dashboard.confirm}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => open({ mode: "edit", transaction: tx })}>
              <Pencil />
              {L.common.edit}
            </DropdownMenuItem>
          )}
          {tx.kind !== "adjustment" && (
            <DropdownMenuItem onSelect={() => open({ mode: "copy", transaction: tx })}>
              <Copy />
              {L.common.copy}
            </DropdownMenuItem>
          )}
          {onHistory && (
            <DropdownMenuItem onSelect={() => onHistory(tx)}>
              <History />
              {L.transactions.history}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate(tx.id)}>
            {pending ? <Undo2 /> : <Trash2 />}
            {pending ? L.recurring.skip : L.common.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
