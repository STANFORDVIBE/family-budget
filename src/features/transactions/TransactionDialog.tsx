import { useEffect, useMemo, useRef, useState } from "react";
import { AmountInput } from "@/components/common/amount-input";
import { Field } from "@/components/common/layout";
import { useMoney } from "@/lib/use-money";
import { AccountSelect, CategorySelect, MemberSelect } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/dates";
import { useAccounts, useCategories, useFindRate, useFormMemory, useMembers, useWsMutation } from "@/lib/queries";
import { impliedRate, normalizeRate } from "@/lib/rates";
import type { Transaction, TransactionInput, TxKind } from "@/lib/types";
import { useApp, useWorkspace } from "@/store/app";

interface FormState {
  id: string;
  kind: TxKind;
  date: string;
  accountId: string | null;
  amount: number | null;
  /** Adjustment create: the real balance. Adjustment edit: unused (amount holds the signed change). */
  targetBalance: number | null;
  toAccountId: string | null;
  toAmount: number | null;
  withFee: boolean;
  fee: number | null;
  categoryId: string | null;
  memberId: string | null;
  comment: string;
  rate: string;
}

function emptyForm(kind: TxKind, accountId: string | null, date = todayIso()): FormState {
  return {
    id: crypto.randomUUID(),
    kind,
    date,
    accountId,
    amount: null,
    targetBalance: null,
    toAccountId: null,
    toAmount: null,
    withFee: false,
    fee: null,
    categoryId: null,
    memberId: null,
    comment: "",
    rate: "",
  };
}

function fromTransaction(t: Transaction, copy: boolean): FormState {
  return {
    id: copy ? crypto.randomUUID() : t.id,
    kind: t.kind,
    date: copy ? todayIso() : t.date,
    accountId: t.accountId,
    amount: t.kind === "adjustment" ? t.amount : Math.abs(t.amount),
    targetBalance: null,
    toAccountId: t.toAccountId,
    toAmount: t.toAmount,
    withFee: t.fee > 0,
    fee: t.fee > 0 ? t.fee : null,
    categoryId: t.categoryId,
    memberId: t.memberId,
    comment: t.comment ?? "",
    rate: "",
  };
}

/** One dialog for creating, editing, copying and confirming operations of every kind. */
export function TransactionDialog() {
  const dialog = useApp((s) => s.txDialog);
  const close = useApp((s) => s.closeTxDialog);
  return (
    <Dialog open={dialog.open} onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xl" onOpenAutoFocus={(e) => e.preventDefault()}>
        {dialog.open && <TransactionForm key={dialog.transaction?.id ?? "new"} />}
      </DialogContent>
    </Dialog>
  );
}

function TransactionForm() {
  const L = useL();
  const workspace = useWorkspace();
  const dialog = useApp((s) => s.txDialog);
  const close = useApp((s) => s.closeTxDialog);
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: members = [] } = useMembers();
  const { data: memory, isFetched: memoryReady } = useFormMemory();
  const { money, decimals } = useMoney();
  const amountRef = useRef<HTMLInputElement>(null);

  const editing = dialog.mode === "edit" || dialog.mode === "confirm";
  const [form, setForm] = useState<FormState>(() =>
    dialog.transaction
      ? fromTransaction(dialog.transaction, dialog.mode === "copy")
      : emptyForm(dialog.kind ?? "expense", dialog.accountId ?? null),
  );
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // Defaults for a new operation: the last used kind and account
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (defaultsApplied.current || dialog.transaction || !memoryReady || accounts.length === 0) return;
    defaultsApplied.current = true;
    const active = accounts.filter((a) => a.isActive);
    const remembered = active.find((a) => a.id === (dialog.accountId ?? memory?.lastAccountId));
    setForm((f) => ({
      ...f,
      kind: dialog.kind ?? (memory?.lastKind === "adjustment" ? "expense" : (memory?.lastKind ?? "expense")),
      accountId: f.accountId ?? remembered?.id ?? active[0]?.id ?? null,
    }));
  }, [accounts, memory, memoryReady, dialog]);

  useEffect(() => {
    const timer = window.setTimeout(() => amountRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [form.kind]);

  const account = accounts.find((a) => a.id === form.accountId) ?? null;
  const toAccount = accounts.find((a) => a.id === form.toAccountId) ?? null;
  const currency = account?.currency ?? workspace.baseCurrency;
  const isTransfer = form.kind === "transfer";
  const isAdjustment = form.kind === "adjustment";
  const crossCurrency = isTransfer && account !== null && toAccount !== null && account.currency !== toAccount.currency;

  // A rate is needed when the account is not in the base currency. For transfers the core can
  // derive it whenever one side is in the base currency.
  const rateCurrency =
    account && account.currency !== workspace.baseCurrency
      ? isTransfer && toAccount?.currency === workspace.baseCurrency
        ? null
        : account.currency
      : null;
  const { data: knownRate, isFetched: rateFetched } = useFindRate(rateCurrency, form.date);
  const rateRequired = rateCurrency !== null && rateFetched && !knownRate;

  const categoryKind = form.kind === "income" ? "income" : "expense";
  const needsCategory = form.kind === "expense" || form.kind === "income";

  const amountValid = isAdjustment
    ? editing
      ? form.amount !== null
      : form.targetBalance !== null
    : form.amount !== null && form.amount > 0;

  const errors = {
    amount: amountValid ? null : L.txForm.invalidAmount,
    account: account ? null : L.txForm.required,
    toAccount: !isTransfer || (toAccount && toAccount.id !== account?.id) ? null : L.txForm.required,
    toAmount: !crossCurrency || (form.toAmount !== null && form.toAmount > 0) ? null : L.txForm.invalidAmount,
    fee: !isTransfer || !form.withFee || (form.fee !== null && form.fee > 0) ? null : L.txForm.invalidAmount,
    category: !needsCategory || form.categoryId ? null : L.txForm.required,
    rate: !rateRequired || normalizeRate(form.rate) ? null : (L.errors.fields.rate ?? L.errors.validation),
    date: form.date ? null : L.txForm.required,
  };
  const valid = Object.values(errors).every((e) => e === null);

  function toInput(): TransactionInput {
    return {
      id: form.id,
      kind: form.kind,
      date: form.date,
      accountId: form.accountId ?? "",
      amount: isAdjustment && !editing ? 0 : (form.amount ?? 0),
      targetBalance: isAdjustment && !editing ? form.targetBalance : null,
      toAccountId: isTransfer ? form.toAccountId : null,
      toAmount: crossCurrency ? form.toAmount : null,
      fee: isTransfer && form.withFee ? form.fee : null,
      categoryId: needsCategory || form.kind === "refund" ? form.categoryId : null,
      memberId: workspace.kind === "family" ? form.memberId : null,
      comment: form.comment.trim() || null,
      rate: rateCurrency && form.rate.trim() ? normalizeRate(form.rate) : null,
    };
  }

  const saveNew = useRef(false);
  const mutation = useWsMutation(
    (workspaceId, input: TransactionInput) => {
      if (dialog.mode === "edit") return api.updateTransaction({ workspaceId, id: form.id, input });
      if (dialog.mode === "confirm") return api.confirmTransaction({ workspaceId, id: form.id, input });
      return api.createTransaction({ workspaceId, input });
    },
    {
      success:
        dialog.mode === "edit" ? L.txForm.updated : dialog.mode === "confirm" ? L.txForm.confirmed : L.txForm.created,
      onSuccess: () => {
        if (saveNew.current) {
          setForm((f) => ({ ...emptyForm(f.kind, f.accountId, f.date), categoryId: f.categoryId, memberId: f.memberId }));
          setTouched(false);
          amountRef.current?.focus();
        } else {
          close();
        }
      },
    },
  );

  function submit(andNew: boolean) {
    setTouched(true);
    if (!valid || mutation.isPending) return;
    saveNew.current = andNew;
    mutation.mutate(toInput());
  }

  const kindOptions = useMemo(
    () =>
      (["expense", "income", "transfer", "refund", "adjustment"] as const).map((k) => ({
        value: k,
        label: L.kinds[k],
      })),
    [L],
  );

  if (accounts.length === 0) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>{L.txForm.createTitle}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground">{L.txForm.noAccounts}</p>
        <DialogFooter>
          <Button
            onClick={() => {
              close();
              useApp.getState().requestCreate("account");
            }}
          >
            {L.accounts.add}
          </Button>
        </DialogFooter>
      </>
    );
  }

  const title = {
    create: L.txForm.createTitle,
    edit: L.txForm.editTitle,
    copy: L.txForm.copyTitle,
    confirm: L.txForm.confirmTitle,
  }[dialog.mode];
  const show = (error: string | null) => (touched ? error : null);
  const adjustmentDelta =
    isAdjustment && !editing && account && form.targetBalance !== null ? form.targetBalance - account.balance : null;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit(false);
      }}
      onKeyDown={(e) => {
        // Enter saves from any single-line field; Ctrl+Enter also works from the comment
        if (e.key === "Enter" && e.ctrlKey) {
          e.preventDefault();
          submit(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>

      {!editing && (
        <SegmentedControl
          aria-label={L.common.status}
          className="w-full [&>*]:flex-1 [&>*]:justify-center"
          value={form.kind}
          options={kindOptions}
          onValueChange={(kind) => set({ kind, categoryId: null, amount: kind === "adjustment" ? null : form.amount })}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        {isAdjustment && !editing ? (
          <Field
            label={L.txForm.targetBalance}
            htmlFor="tx-amount"
            error={show(errors.amount)}
            hint={
              account &&
              (adjustmentDelta !== null
                ? fmt(L.txForm.adjustmentChange, { value: money(adjustmentDelta, currency, { sign: true }) })
                : fmt(L.txForm.currentBalance, { value: money(account.balance, currency) }))
            }
          >
            <AmountInput
              id="tx-amount"
              ref={amountRef}
              currency={currency}
              allowNegative
              value={form.targetBalance}
              invalid={!!show(errors.amount)}
              onValueChange={(targetBalance) => set({ targetBalance })}
            />
          </Field>
        ) : (
          <Field label={L.txForm.amount} htmlFor="tx-amount" error={show(errors.amount)}>
            <AmountInput
              id="tx-amount"
              ref={amountRef}
              currency={currency}
              allowNegative={isAdjustment}
              value={form.amount}
              invalid={!!show(errors.amount)}
              onValueChange={(amount) => set({ amount })}
            />
          </Field>
        )}
        <Field label={L.txForm.date} htmlFor="tx-date" error={show(errors.date)}>
          <Input id="tx-date" type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} />
        </Field>

        <Field
          label={isTransfer ? L.txForm.fromAccount : L.txForm.account}
          htmlFor="tx-account"
          error={show(errors.account)}
          className={isTransfer ? undefined : "col-span-2"}
        >
          <AccountSelect
            id="tx-account"
            accounts={accounts}
            value={form.accountId}
            invalid={!!show(errors.account)}
            onChange={(accountId) => set({ accountId })}
          />
        </Field>
        {isTransfer && (
          <Field label={L.txForm.toAccount} htmlFor="tx-to-account" error={show(errors.toAccount)}>
            <AccountSelect
              id="tx-to-account"
              accounts={accounts}
              exclude={form.accountId}
              value={form.toAccountId}
              invalid={!!show(errors.toAccount)}
              onChange={(toAccountId) => set({ toAccountId })}
            />
          </Field>
        )}

        {crossCurrency && toAccount && (
          <Field
            label={L.txForm.toAmount}
            htmlFor="tx-to-amount"
            error={show(errors.toAmount)}
            className="col-span-2"
            hint={(() => {
              const rate =
                form.amount && form.toAmount ? impliedRate(
                      form.amount,
                      form.toAmount,
                      { currency, decimals: decimals(currency) },
                      { currency: toAccount.currency, decimals: decimals(toAccount.currency) },
                    ) : null;
              return rate ? fmt(L.txForm.impliedRate, { from: currency, rate, to: toAccount.currency }) : null;
            })()}
          >
            <AmountInput
              id="tx-to-amount"
              currency={toAccount.currency}
              value={form.toAmount}
              invalid={!!show(errors.toAmount)}
              onValueChange={(toAmount) => set({ toAmount })}
            />
          </Field>
        )}

        {isTransfer && (
          <div className="col-span-2 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.withFee} onCheckedChange={(v) => set({ withFee: v === true })} />
              {L.txForm.addFee}
            </label>
            {form.withFee && (
              <AmountInput
                aria-label={L.txForm.fee}
                currency={currency}
                value={form.fee}
                invalid={!!show(errors.fee)}
                onValueChange={(fee) => set({ fee })}
              />
            )}
          </div>
        )}

        {(needsCategory || form.kind === "refund") && (
          <Field
            label={form.kind === "refund" ? L.txForm.refundCategory : L.txForm.category}
            htmlFor="tx-category"
            error={show(errors.category)}
            className={workspace.kind === "family" ? undefined : "col-span-2"}
          >
            <CategorySelect
              id="tx-category"
              categories={categories}
              kind={categoryKind}
              value={form.categoryId}
              invalid={!!show(errors.category)}
              allowNone={form.kind === "refund" ? L.common.noCategory : undefined}
              placeholder={L.common.none}
              onChange={(categoryId) => set({ categoryId })}
            />
          </Field>
        )}
        {workspace.kind === "family" && (
          <Field label={L.txForm.member} htmlFor="tx-member">
            <MemberSelect
              id="tx-member"
              members={members}
              value={form.memberId}
              allowNone={L.common.none}
              onChange={(memberId) => set({ memberId })}
            />
          </Field>
        )}

        {rateCurrency && (
          <Field
            label={fmt(L.txForm.rate, { base: workspace.baseCurrency })}
            htmlFor="tx-rate"
            error={show(errors.rate)}
            className="col-span-2"
            hint={
              knownRate
                ? fmt(L.txForm.rateFound, { rate: knownRate })
                : rateRequired
                  ? fmt(L.txForm.rateMissing, { from: rateCurrency, base: workspace.baseCurrency })
                  : null
            }
          >
            <Input
              id="tx-rate"
              inputMode="decimal"
              placeholder={knownRate ?? fmt(L.txForm.rateHint, { from: rateCurrency, base: workspace.baseCurrency })}
              value={form.rate}
              aria-invalid={!!show(errors.rate) || undefined}
              onChange={(e) => set({ rate: e.target.value })}
            />
          </Field>
        )}

        <Field label={L.txForm.comment} htmlFor="tx-comment" className="col-span-2">
          <Textarea
            id="tx-comment"
            rows={2}
            maxLength={500}
            value={form.comment}
            onChange={(e) => set({ comment: e.target.value })}
          />
        </Field>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={close}>
          {L.common.cancel}
        </Button>
        {dialog.mode !== "edit" && dialog.mode !== "confirm" && (
          <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={() => submit(true)}>
            {L.txForm.saveAndNew}
          </Button>
        )}
        <Button type="submit" disabled={mutation.isPending} data-testid="tx-save">
          {dialog.mode === "confirm" ? L.txForm.confirm : L.txForm.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
