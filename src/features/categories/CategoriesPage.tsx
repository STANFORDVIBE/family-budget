import { Ellipsis, Eye, EyeOff, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { IconBadge } from "@/components/common/icons";
import { Field, Page, PageHeader, Skeleton } from "@/components/common/layout";
import { CategorySelect, ColorPicker, IconPicker, NONE } from "@/components/common/pickers";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { useCategories, useWsMutation } from "@/lib/queries";
import type { Category, CategoryInput, CategoryKind } from "@/lib/types";
import { cn } from "@/lib/utils";

type Editing = { category: Category | null; parentId: string | null } | null;

export function CategoriesPage() {
  const L = useL();
  const { data: categories = [], isLoading } = useCategories();
  const [kind, setKind] = useState<CategoryKind>("expense");
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const hide = useWsMutation((workspaceId, a: { id: string; hidden: boolean }) =>
    api.setCategoryHidden({ workspaceId, ...a }),
  );

  const visible = categories.filter((c) => c.kind === kind && (showHidden || !c.isHidden));
  const parents = visible.filter((c) => c.parentId === null);

  const row = (c: Category, child: boolean) => (
    <div
      key={c.id}
      className={cn("group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60", child && "pl-10", c.isHidden && "opacity-55")}
      data-testid="category-row"
    >
      <IconBadge icon={c.icon} color={c.color} size={child ? "sm" : "md"} />
      <button
        type="button"
        className="min-w-0 flex-1 truncate text-left outline-none"
        onClick={() => setEditing({ category: c, parentId: c.parentId })}
      >
        {c.name}
      </button>
      {c.isHidden && <Badge variant="outline">{L.categories.hidden}</Badge>}
      {c.usageCount > 0 && (
        <span className="text-xs text-muted-foreground">{fmt(L.categories.uses, { n: c.usageCount })}</span>
      )}
      {!child && (
        <Button
          variant="ghost"
          size="xs"
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing({ category: null, parentId: c.id })}
        >
          <Plus />
          {L.categories.addSub}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={L.common.more}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setEditing({ category: c, parentId: c.parentId })}>
            <Pencil />
            {L.common.edit}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => hide.mutate({ id: c.id, hidden: !c.isHidden })}>
            {c.isHidden ? <Eye /> : <EyeOff />}
            {c.isHidden ? L.common.show : L.common.hide}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
            <Trash2 />
            {L.common.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <Page>
      <PageHeader
        title={L.categories.title}
        actions={
          <Button onClick={() => setEditing({ category: null, parentId: null })}>
            <Plus />
            {L.categories.add}
          </Button>
        }
      />
      <div className="flex items-center justify-between gap-3">
        <SegmentedControl
          aria-label={L.categories.title}
          value={kind}
          onValueChange={setKind}
          options={[
            { value: "expense", label: L.categories.expense },
            { value: "income", label: L.categories.income },
          ]}
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch checked={showHidden} onCheckedChange={setShowHidden} />
          {L.categories.showHidden}
        </label>
      </div>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <Card size="sm">
          <CardContent className="gap-0">
            {parents.map((p) => (
              <div key={p.id}>
                {row(p, false)}
                {visible.filter((c) => c.parentId === p.id).map((c) => row(c, true))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          {editing && (
            <CategoryForm
              key={editing.category?.id ?? `new-${editing.parentId}`}
              category={editing.category}
              parentId={editing.parentId}
              kind={kind}
              categories={categories}
              onClose={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <DeleteCategory category={deleting} categories={categories} onClose={() => setDeleting(null)} />
    </Page>
  );
}

function CategoryForm({
  category,
  parentId,
  kind,
  categories,
  onClose,
}: {
  category: Category | null;
  parentId: string | null;
  kind: CategoryKind;
  categories: Category[];
  onClose: () => void;
}) {
  const L = useL();
  const parent = categories.find((c) => c.id === parentId);
  const [form, setForm] = useState<CategoryInput>(() =>
    category
      ? {
          name: category.name,
          kind: category.kind,
          parentId: category.parentId,
          icon: category.icon,
          color: category.color,
        }
      : {
          id: crypto.randomUUID(),
          name: "",
          kind: parent?.kind ?? kind,
          parentId,
          icon: parent?.icon ?? "ellipsis",
          color: parent?.color ?? "#0f7c74",
        },
  );
  const set = (patch: Partial<CategoryInput>) => setForm((f) => ({ ...f, ...patch }));
  const save = useWsMutation(
    (workspaceId, input: CategoryInput) =>
      category ? api.updateCategory({ workspaceId, id: category.id, input }) : api.createCategory({ workspaceId, input }),
    { success: L.common.saved, onSuccess: onClose },
  );
  // Only two levels: a parent cannot itself be a child, and a category with children stays a parent
  const hasChildren = category ? categories.some((c) => c.parentId === category.id) : false;
  const parentOptions = categories.filter(
    (c) => c.kind === form.kind && c.parentId === null && c.id !== category?.id && !c.isHidden,
  );

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name.trim()) save.mutate({ ...form, name: form.name.trim() });
      }}
    >
      <DialogHeader>
        <DialogTitle>{category ? L.categories.editTitle : L.categories.createTitle}</DialogTitle>
      </DialogHeader>
      <Field label={L.common.name} htmlFor="cat-name">
        <Input id="cat-name" autoFocus maxLength={60} value={form.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      {!hasChildren && (
        <Field label={L.categories.parent} htmlFor="cat-parent">
          <Select value={form.parentId ?? NONE} onValueChange={(v) => set({ parentId: v === NONE ? null : v })}>
            <SelectTrigger id="cat-parent" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectItem value={NONE}>{L.categories.noParent}</SelectItem>
              {parentOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <IconBadge icon={c.icon} color={c.color} size="sm" />
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <Field label={L.common.color}>
        <ColorPicker value={form.color} onChange={(color) => set({ color })} />
      </Field>
      <Field label={L.common.icon}>
        <IconPicker value={form.icon} color={form.color} onChange={(icon) => set({ icon })} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {L.common.cancel}
        </Button>
        <Button type="submit" disabled={!form.name.trim() || save.isPending}>
          {L.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeleteCategory({
  category,
  categories,
  onClose,
}: {
  category: Category | null;
  categories: Category[];
  onClose: () => void;
}) {
  const L = useL();
  const [target, setTarget] = useState<string | null>(null);
  const remove = useWsMutation(
    (workspaceId, a: { id: string; reassignTo: string | null }) => api.deleteCategory({ workspaceId, ...a }),
    {
      success: L.common.deleted,
      onSuccess: () => {
        setTarget(null);
        onClose();
      },
    },
  );
  if (!category) return null;
  const hasChildren = categories.some((c) => c.parentId === category.id);
  const inUse = category.usageCount > 0;
  const options = categories.filter((c) => c.id !== category.id && c.kind === category.kind && c.parentId !== category.id);

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={L.categories.deleteTitle}
      text={
        hasChildren
          ? L.categories.hasChildren
          : inUse
            ? fmt(L.categories.reassignText, { n: category.usageCount })
            : L.categories.deleteText
      }
      pending={remove.isPending || hasChildren || (inUse && !target)}
      onConfirm={() => remove.mutate({ id: category.id, reassignTo: inUse ? target : null })}
    >
      {inUse && !hasChildren && (
        <Field label={L.categories.reassignTo}>
          <CategorySelect
            categories={options}
            kind={category.kind}
            value={target}
            placeholder={L.common.none}
            onChange={setTarget}
          />
        </Field>
      )}
    </ConfirmDialog>
  );
}
