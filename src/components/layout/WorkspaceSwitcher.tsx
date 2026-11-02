import { Check, ChevronsUpDown, Plus, User, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import type { WorkspaceKind } from "@/lib/types";
import { useApp, useWorkspace } from "@/store/app";

/** Switches between the personal and family budgets; their data never mix. */
export function WorkspaceSwitcher() {
  const L = useL();
  const current = useWorkspace();
  const workspaces = useApp((s) => s.workspaces);
  const [creating, setCreating] = useState(false);

  async function select(id: string) {
    if (id === current.id) return;
    useApp.getState().setWorkspace(id);
    try {
      useApp.getState().setSettings(await api.updateSettings({ activeWorkspaceId: id }));
    } catch {
      // the switch itself already happened; remembering it is best effort
    }
  }

  const Icon = current.kind === "family" ? Users : User;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-testid="workspace-switcher"
            className="flex w-full items-center gap-2.5 rounded-lg bg-sidebar-accent/60 px-2.5 py-2 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{current.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {current.kind === "family" ? L.workspace.familyShort : L.workspace.personalShort} · {current.baseCurrency}
              </span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64">
          <DropdownMenuLabel>{L.workspace.switchTitle}</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => void select(w.id)}>
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
      <CreateWorkspaceDialog open={creating} onOpenChange={setCreating} onCreated={(id) => void select(id)} />
    </>
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
      const created = await api.createWorkspace({ name: name.trim(), kind, baseCurrency: currency });
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
