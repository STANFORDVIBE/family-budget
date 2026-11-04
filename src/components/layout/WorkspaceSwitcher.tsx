import { Check, ChevronsUpDown, Pencil, Plus, Trash2, User, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Field } from "@/components/common/layout";
import { CurrencySelect } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { Workspace, WorkspaceKind } from "@/lib/types";
import { useApp, useWorkspace } from "@/store/app";

/** Makes a workspace the active one and remembers the choice for the next start. */
async function activate(id: string) {
  if (id === useApp.getState().workspaceId) return;
  useApp.getState().setWorkspace(id);
  try {
    useApp.getState().setSettings(await api.updateSettings({ activeWorkspaceId: id }));
  } catch {
    // the switch itself already happened; remembering it is best effort
  }
}

/** Switches between the personal and family budgets; their data never mix. Right click deletes one. */
export function WorkspaceSwitcher() {
  const L = useL();
  const current = useWorkspace();
  const workspaces = useApp((s) => s.workspaces);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [context, setContext] = useState<{
    x: number;
    y: number;
    workspace: Workspace;
  } | null>(null);
  const [editing, setEditing] = useState<Workspace | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);

  /** Right click: a small menu at the pointer with "edit" and "delete". */
  function openContext(event: React.MouseEvent, workspace: Workspace) {
    event.preventDefault();
    setMenuOpen(false);
    setContext({ x: event.clientX, y: event.clientY, workspace });
  }

  const Icon = current.kind === "family" ? Users : User;
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="workspace-switcher"
            // Open on click, not on pointer down: right after a hotkey the pointer-down opening was
            // dismissed by the same event as an "outside" press, and the menu never showed
            onPointerDown={(e) => e.button === 0 && e.preventDefault()}
            onClick={() => setMenuOpen((open) => !open)}
            onContextMenu={(e) => openContext(e, current)}
            className="flex w-full items-center gap-2.5 rounded-lg bg-sidebar-accent/60 px-2.5 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{current.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {current.kind === "family" ? L.workspace.familyShort : L.workspace.personalShort} ·{" "}
                {current.baseCurrency}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuLabel>{L.workspace.switchTitle}</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => void activate(w.id)} onContextMenu={(e) => openContext(e, w)}>
              {w.kind === "family" ? <Users /> : <User />}
              <span className="flex-1 truncate">{w.name}</span>
              {w.id === current.id && <Check className="text-primary" />}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus />
            {L.workspace.create}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreated={(id) => void activate(id)} />
      <DropdownMenu open={context !== null} onOpenChange={(open) => !open && setContext(null)}>
        <DropdownMenuTrigger asChild>
          {/* invisible anchor at the pointer: the menu opens where the user clicked */}
          <span
            aria-hidden
            className="pointer-events-none fixed size-0"
            style={{ left: context?.x, top: context?.y }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48" data-testid="workspace-context-menu">
          <DropdownMenuItem onSelect={() => setEditing(context?.workspace ?? null)}>
            <Pencil />
            {L.common.edit}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            // the last workspace cannot be deleted
            disabled={workspaces.length < 2}
            onSelect={() => setDeleting(context?.workspace ?? null)}
          >
            <Trash2 />
            {L.common.delete}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditWorkspaceDialog workspace={editing} onClose={() => setEditing(null)} />
      <DeleteWorkspaceDialog workspace={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/** Renames a workspace. The base currency is changed in settings: it has its own rules. */
function EditWorkspaceDialog({ workspace, onClose }: { workspace: Workspace | null; onClose: () => void }) {
  return (
    <Dialog open={workspace !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* keyed: the field starts from the name of the workspace being edited */}
        {workspace && <EditWorkspaceForm key={workspace.id} workspace={workspace} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditWorkspaceForm({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const L = useL();
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await api.updateWorkspace(workspace.id, {
        name: name.trim(),
        baseCurrency: workspace.baseCurrency,
      });
      const store = useApp.getState();
      store.setWorkspaces(store.workspaces.map((w) => (w.id === updated.id ? updated : w)));
      toast.success(L.common.saved);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, L));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{L.workspace.editTitle}</DialogTitle>
      </DialogHeader>
      <Field label={L.workspace.name} htmlFor="ws-edit-name">
        <Input id="ws-edit-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {L.common.cancel}
        </Button>
        <Button type="submit" disabled={!name.trim() || name.trim() === workspace.name || busy}>
          {L.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Confirms and deletes a workspace (a backup is saved first). If it was the active one, another opens. */
export function DeleteWorkspaceDialog({ workspace, onClose }: { workspace: Workspace | null; onClose: () => void }) {
  const L = useL();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!workspace || busy) return;
    setBusy(true);
    try {
      const backup = await api.deleteWorkspace({ workspaceId: workspace.id });
      const store = useApp.getState();
      const left = store.workspaces.filter((w) => w.id !== workspace.id);
      // switch first: the screens of the deleted workspace must not render without it
      if (store.workspaceId === workspace.id && left[0]) await activate(left[0].id);
      useApp.getState().setWorkspaces(left);
      toast.success(fmt(L.settings.workspaceDeleted, { name: backup }));
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, L));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      open={workspace !== null}
      onOpenChange={(open) => !open && onClose()}
      title={fmt(L.settings.deleteWorkspaceTitle, {
        name: workspace?.name ?? "",
      })}
      text={L.settings.deleteWorkspaceText}
      confirmLabel={L.common.delete}
      pending={busy}
      onConfirm={() => void confirm()}
    />
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const L = useL();
  const current = useWorkspace();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WorkspaceKind>("family");
  const [currency, setCurrency] = useState(current.baseCurrency);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api.createWorkspace({
        name: name.trim(),
        kind,
        baseCurrency: currency,
      });
      const store = useApp.getState();
      store.setWorkspaces([...store.workspaces, created]);
      toast.success(L.workspace.created);
      onOpenChange(false);
      setName("");
      onCreated(created.id);
    } catch (error) {
      toast.error(errorMessage(error, L));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{L.workspace.createTitle}</DialogTitle>
          </DialogHeader>
          <Field label={L.workspace.kind}>
            <SegmentedControl
              aria-label={L.workspace.kind}
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "family", label: L.workspace.family, icon: Users },
                { value: "personal", label: L.workspace.personal, icon: User },
              ]}
            />
          </Field>
          <Field label={L.workspace.name} htmlFor="ws-name">
            <Input id="ws-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={L.workspace.baseCurrency} htmlFor="ws-currency">
            <CurrencySelect id="ws-currency" value={currency} onChange={setCurrency} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {L.common.cancel}
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {L.common.add}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
