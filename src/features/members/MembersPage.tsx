import { Pencil, Plus, Users } from "lucide-react";
import { useState } from "react";
import { EmptyState, Field, Page, PageHeader, Skeleton } from "@/components/common/layout";
import { SimpleSelect } from "@/components/common/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { dayLabel } from "@/lib/dates";
import { useMembers, useWsMutation } from "@/lib/queries";
import type { Member, MemberRole } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/store/app";

export function MembersPage() {
  const L = useL();
  const workspace = useWorkspace();
  const { data: members, isLoading } = useMembers();
  const [editing, setEditing] = useState<Member | "new" | null>(null);

  if (workspace.kind !== "family") {
    return (
      <Page>
        <Card>
          <EmptyState icon={Users} title={L.members.onlyFamily} />
        </Card>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={L.members.title}
        description={L.members.hint}
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus />
            {L.members.add}
          </Button>
        }
      />
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <Card size="sm">
          <CardContent className="gap-0">
            {members?.map((m) => (
              <div
                key={m.id}
                className={cn("flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-muted/60", m.status === "inactive" && "opacity-60")}
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-primary/15 font-medium text-primary">
                  {m.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.name}</span>
                    {m.isMe && <Badge variant="secondary">{L.members.me}</Badge>}
                    {m.status === "inactive" && <Badge variant="outline">{L.members.inactive}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {L.roles[m.role]} · {L.members.joined} {dayLabel(m.joinedOn)}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" aria-label={L.common.edit} onClick={() => setEditing(m)}>
                  <Pencil />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          {editing !== null && (
            <MemberForm key={editing === "new" ? "new" : editing.id} member={editing} onClose={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function MemberForm({ member, onClose }: { member: Member | "new"; onClose: () => void }) {
  const L = useL();
  const existing = member === "new" ? null : member;
  const [name, setName] = useState(existing?.name ?? "");
  const [role, setRole] = useState<MemberRole>(existing?.role ?? "member");
  const [active, setActive] = useState(existing?.status !== "inactive");
  const owner = existing?.role === "owner";

  const save = useWsMutation(
    (workspaceId, _: void) =>
      existing
        ? api.updateMember({
            workspaceId,
            id: existing.id,
            input: { name: name.trim(), role, status: active ? "active" : "inactive" },
          })
        : api.createMember({ workspaceId, input: { name: name.trim(), role } }),
    { success: L.common.saved, onSuccess: onClose },
  );

  const roles: MemberRole[] = owner ? ["owner"] : ["admin", "member", "viewer"];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{existing ? L.members.editTitle : L.members.createTitle}</DialogTitle>
      </DialogHeader>
      <Field label={L.members.name} htmlFor="member-name">
        <Input id="member-name" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={L.members.role} htmlFor="member-role">
        <SimpleSelect
          id="member-role"
          value={role}
          onChange={setRole}
          options={roles.map((r) => ({ value: r, label: L.roles[r] }))}
        />
      </Field>
      {existing && !owner && (
        <label className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-sm">
          {L.members.active}
          <Switch checked={active} onCheckedChange={setActive} />
        </label>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {L.common.cancel}
        </Button>
        <Button type="submit" disabled={!name.trim() || save.isPending}>
          {L.common.save}
        </Button>
      </DialogFooter>
    </form>
  );
}
