import { Check } from "lucide-react";
import { DynamicIcon, IconBadge } from "@/components/common/icons";
import { COLORS, ICON_KEYS } from "@/lib/icons";
import { useMoney } from "@/lib/use-money";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useL } from "@/i18n";
import type { Account, Category, CategoryKind, Member } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useApp } from "@/store/app";

// Radix Select cannot hold an empty value, so "nothing selected" is this sentinel.
export const NONE = "__none";

export function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const L = useL();
  return (
    <div role="radiogroup" aria-label={L.common.color} className="flex flex-wrap gap-1.5">
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          onClick={() => onChange(color)}
          className="flex size-7 items-center justify-center rounded-full ring-offset-2 ring-offset-popover outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ backgroundColor: color }}
        >
          {value === color && <Check className="size-4 text-white" />}
        </button>
      ))}
    </div>
  );
}

export function IconPicker({ value, color, onChange }: { value: string; color: string; onChange: (icon: string) => void }) {
  const L = useL();
  return (
    <div role="radiogroup" aria-label={L.common.icon} className="grid max-h-36 grid-cols-10 gap-1 overflow-y-auto p-0.5">
      {ICON_KEYS.map((key) => {
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={key}
            onClick={() => onChange(key)}
            className={cn(
              "flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              selected && "bg-muted",
            )}
            style={selected ? { color } : undefined}
          >
            <DynamicIcon name={key} className="size-4" />
          </button>
        );
      })}
    </div>
  );
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  id,
  placeholder,
  allowNone,
  invalid,
  exclude,
}: {
  accounts: Account[];
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  placeholder?: string;
  allowNone?: string;
  invalid?: boolean;
  exclude?: string | null;
}) {
  const { money } = useMoney();
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper">
        {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
        {accounts
          .filter((a) => a.id !== exclude && (a.isActive || a.id === value))
          .map((a) => (
            <SelectItem key={a.id} value={a.id}>
              <IconBadge icon={a.icon} color={a.color} size="sm" />
              <span className="truncate">{a.name}</span>
              <span className="ml-auto pl-3 text-xs text-muted-foreground tabular">{money(a.balance, a.currency)}</span>
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

/** Two-level category list: parents with their children indented. Hidden ones are skipped. */
export function CategorySelect({
  categories,
  kind,
  value,
  onChange,
  id,
  placeholder,
  allowNone,
  invalid,
}: {
  categories: Category[];
  kind: CategoryKind;
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  placeholder?: string;
  allowNone?: string;
  invalid?: boolean;
}) {
  const visible = categories.filter((c) => c.kind === kind && (!c.isHidden || c.id === value));
  const parents = visible.filter((c) => c.parentId === null);
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
        {parents.map((parent) => (
          <CategoryGroup key={parent.id} parent={parent} items={visible.filter((c) => c.parentId === parent.id)} />
        ))}
      </SelectContent>
    </Select>
  );
}

function CategoryGroup({ parent, items }: { parent: Category; items: Category[] }) {
  return (
    <SelectGroup className="p-0">
      <SelectItem value={parent.id}>
        <IconBadge icon={parent.icon} color={parent.color} size="sm" />
        {parent.name}
      </SelectItem>
      {items.map((child) => (
        <SelectItem key={child.id} value={child.id} className="pl-8">
          <IconBadge icon={child.icon} color={child.color} size="sm" />
          {child.name}
        </SelectItem>
      ))}
    </SelectGroup>
  );
}

export function MemberSelect({
  members,
  value,
  onChange,
  id,
  allowNone,
}: {
  members: Member[];
  value: string | null;
  onChange: (id: string | null) => void;
  id?: string;
  allowNone?: string;
}) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {allowNone && <SelectItem value={NONE}>{allowNone}</SelectItem>}
        {members
          .filter((m) => m.status === "active" || m.id === value)
          .map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}

const POPULAR = ["RUB", "USD", "EUR", "KZT", "BYN", "UAH", "GBP", "CNY", "TRY", "GEL", "AMD", "UZS"];

export function CurrencySelect({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  id?: string;
  disabled?: boolean;
}) {
  const currencies = useApp((s) => s.currencies);
  const L = useL();
  const popular = POPULAR.map((code) => currencies.find((c) => c.code === code)).filter((c) => c !== undefined);
  const rest = currencies.filter((c) => !POPULAR.includes(c.code));
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-80">
        <SelectGroup>
          {popular.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="w-10 font-medium">{c.code}</span>
              <span className="text-muted-foreground">{c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{L.common.all}</SelectLabel>
          {rest.map((c) => (
            <SelectItem key={c.code} value={c.code}>
              <span className="w-10 font-medium">{c.code}</span>
              <span className="text-muted-foreground">{c.name}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** A plain select over a list of string options. */
export function SimpleSelect<T extends string>({
  value,
  options,
  onChange,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
