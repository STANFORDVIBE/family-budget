import { Archive, ArchiveRestore, Ellipsis, ListFilter, Pencil, Plus, Scale, Trash2, Wallet } from "lucide-react";
import { useState } from "react";
import { AmountInput } from "@/components/common/amount-input";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconBadge } from "@/components/common/icons";
import { EmptyState, Field, Page, PageHeader, Skeleton } from "@/components/common/layout";
import { Money } from "@/components/common/money";
import { ColorPicker, CurrencySelect, IconPicker, SimpleSelect } from "@/components/common/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { ACCOUNT_ICONS } from "@/lib/icons";
import { useAccounts, useWsMutation } from "@/lib/queries";
import type { Account, AccountInput, AccountKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp, useWorkspace } from "@/store/app";

const KINDS: AccountKind[] = ["cash", "debit_card", "credit_card", "bank", "savings", "ewallet", "other"];

export function AccountsPage() {
  const L = useL();
  const { data: accounts, isLoading } = useAccounts();
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  // "New account" from the quick actions menu, also when this screen is already open
  const intent = useApp((s) => s.createIntent);
  const dialogAccount = editing ?? (intent === "account" ? "new" : null);
  function closeDialog() {
    if (intent === "account") useApp.getState().consumeCreate();
    setEditing(null);
  }

  const setActive = useWsMutation((workspaceId, a: { id: string; active: boolean }) =>
    api.setAccountActive({ workspaceId, ...a }),
  );
  const remove = useWsMutation((workspaceId, id: string) => api.deleteAccount({ workspaceId, id }), {
    success: L.common.deleted,
    onSuccess: () => setDeleting(null),
  });

  const active = accounts?.filter((a) => a.isActive) ?? [];
  const archived = accounts?.filter((a) => !a.isActive) ?? [];

  return (
    <Page>
      <PageHeader
        title={L.accounts.title}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {L.accounts.add}
          </Button>
        }
      />
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : active.length === 0 && archived.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title={L.accounts.empty}
            text={L.accounts.emptyHint}
            action={<Button onClick={() => setEditing("new")}>{L.accounts.add}</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
            {active.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                onEdit={() => setEditing(a)}
                onArchive={() => setActive.mutate({ id: a.id, active: false })}
                onDelete={() => setDeleting(a)}
              />
            ))}
          </div>
          {archived.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="text-sm text-muted-foreground">{L.accounts.archived}</h3>
              <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
                {archived.map((a) => (
                  <AccountCard
                    key={a.id}
                    account={a}
                    onEdit={() => setEditing(a)}
                    onArchive={() => setActive.mutate({ id: a.id, active: true })}
                    onDelete={() => setDeleting(a)}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}
      <AccountDialog account={dialogAccount} onClose={closeDialog} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={L.accounts.deleteTitle}
        text={L.accounts.deleteText}
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </Page>
  );
}

function AccountCard({
  account: a,
  onEdit,
  onArchive,
  onDelete,
}: {
  account: Account;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const L = useL();
  const credit = a.kind === "credit_card";
  const available = credit && a.creditLimit !== null ? a.creditLimit + a.balance : null;
  return (
    <Card size="sm" className={cn(!a.isActive && "opacity-60")} data-testid="account-card">
      <CardContent>
        <div className="flex items-start gap-3">
          <IconBadge icon={a.icon} color={a.color} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{a.name}</div>
            <div className="text-xs text-muted-foreground">
              {L.accountKinds[a.kind]} · {a.currency}
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={L.common.more}>
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil />
                {L.common.edit}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => useApp.getState().openOperations({ accountId: a.id })}>
                <ListFilter />
                {L.accounts.operations}
              </DropdownMenuItem>
              {a.isActive && (
                <DropdownMenuItem
                  onSelect={() => useApp.getState().openTxDialog({ mode: "create", kind: "adjustment", accountId: a.id })}
                >
                  <Scale />
                  {L.accounts.adjust}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onArchive}>
                {a.isActive ? <Archive /> : <ArchiveRestore />}
                {a.isActive ? L.common.archive : L.common.unarchive}
              </DropdownMenuItem>
              {!a.hasOperations && (
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 />
                  {L.common.delete}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="text-xs text-muted-foreground">
              {credit && a.balance < 0 ? L.accounts.debt : L.accounts.balance}
            </div>
            <Money
              amount={credit && a.balance < 0 ? -a.balance : a.balance}
              currency={a.currency}
              tone={credit && a.balance < 0 ? "expense" : "none"}
              className="text-xl font-semibold"
            />
          </div>
          {available !== null && (
            <Badge variant="secondary">
              {L.accounts.available} <Money amount={available} currency={a.currency} compact />
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AccountDialog({ account, onClose }: { account: Account | "new" | null; onClose: () => void }) {
  const L = useL();
  return (
    <Dialog open={account !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {account !== null && (
          <AccountForm key={account === "new" ? "new" : account.id} account={account} onClose={onClose} L={L} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccountForm({
  account,
  onClose,
  L,
}: {
  account: Account | "new";
  onClose: () => void;
  L: ReturnType<typeof useL>;
}) {
  const workspace = useWorkspace();
  const existing = account === "new" ? null : account;
  const [form, setForm] = useState<AccountInput>(() =>
    existing
      ? {
          name: existing.name,
          kind: existing.kind,
          currency: existing.currency,
          initialBalance: existing.initialBalance,
          creditLimit: existing.creditLimit,
          icon: existing.icon,
          color: existing.color,
        }
      : {
          id: crypto.randomUUID(),
          name: "",
          kind: "debit_card",
          currency: workspace.baseCurrency,
          initialBalance: 0,
          creditLimit: null,
          icon: ACCOUNT_ICONS.debit_card ?? "wallet",
          color: "#0f7c74",
        },
  );
  const [initialValid, setInitialValid] = useState(true);
  const set = (patch: Partial<AccountInput>) => setForm((f) => ({ ...f, ...patch }));

  const save = useWsMutation(
    (workspaceId, input: AccountInput) =>
      existing ? api.updateAccount({ workspaceId, id: existing.id, input }) : api.createAccount({ workspaceId, input }),
    { success: existing ? L.common.saved : L.accounts.created, onSuccess: onClose },
  );

  const valid = form.name.trim() !== "" && initialValid;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate({ ...form, name: form.name.trim() });
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? L.accounts.editTitle : L.accounts.createTitle}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.accounts.name} htmlFor="acc-name" className="col-span-2">
          <Input
            id="acc-name"
            autoFocus
            maxLength={60}
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label={L.accounts.kind} htmlFor="acc-kind">
          <SimpleSelect
            id="acc-kind"
            value={form.kind}
            options={KINDS.map((k) => ({ value: k, label: L.accountKinds[k] }))}
            onChange={(kind) =>
              set({
                kind,
                icon: ACCOUNT_ICONS[kind] ?? form.icon,
                creditLimit: kind === "credit_card" ? form.creditLimit : null,
              })
            }
          />
        </Field>
        <Field
          label={L.accounts.currency}
          htmlFor="acc-currency"
          hint={existing?.hasOperations ? L.accounts.currencyLocked : undefined}
        >
          <CurrencySelect
            id="acc-currency"
            value={form.currency}
            disabled={existing?.hasOperations}
            onChange={(currency) => set({ currency })}
          />
        </Field>
        <Field
          label={L.accounts.initialBalance}
          htmlFor="acc-initial"
          hint={L.accounts.initialHint}
          className={form.kind === "credit_card" ? undefined : "col-span-2"}
        >
          <AmountInput
            id="acc-initial"
            currency={form.currency}
            allowNegative
            value={form.initialBalance}
            invalid={!initialValid}
            onValueChange={(v) => {
              setInitialValid(v !== null);
              if (v !== null) set({ initialBalance: v });
            }}
          />
        </Field>
        {form.kind === "credit_card" && (
          <Field label={L.accounts.creditLimit} htmlFor="acc-limit" hint={L.accounts.creditLimitHint}>
            <AmountInput
              id="acc-limit"
              currency={form.currency}
              value={form.creditLimit}
              onValueChange={(creditLimit) => set({ creditLimit })}
            />
          </Field>
        )}
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
