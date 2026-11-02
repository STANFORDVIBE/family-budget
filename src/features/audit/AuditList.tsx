import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useL } from "@/i18n";
import { useAudit } from "@/lib/queries";
import type { AuditEntry } from "@/lib/types";

const timeFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" });

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  const L = useL();
  if (entries.length === 0) return <p className="py-6 text-center text-muted-foreground">{L.audit.empty}</p>;
  const actions = L.audit as unknown as Record<string, string>;
  const entities = L.audit.entities as Record<string, string>;
  return (
    <ul className="flex flex-col divide-y">
      {entries.map((e) => (
        <li key={e.id} className="flex items-baseline gap-3 py-2 text-sm">
          <span className="w-32 shrink-0 text-xs text-muted-foreground tabular">{timeFormat.format(e.at)}</span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{entities[e.entity] ?? e.entity}</span>
            {" — "}
            {actions[e.action] ?? e.action}
            {describe(e) && <span className="text-muted-foreground"> · {describe(e)}</span>}
          </span>
          {e.userName && <span className="shrink-0 text-xs text-muted-foreground">{e.userName}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A short human hint from the stored snapshot: a name or a comment, never raw JSON. */
function describe(entry: AuditEntry): string | null {
  const value = entry.newValue ?? entry.oldValue;
  if (!value) return null;
  for (const key of ["name", "comment"]) {
    const v = value[key];
    if (typeof v === "string" && v) return v.length > 60 ? v.slice(0, 60) + "…" : v;
  }
  return null;
}

export function HistoryDialog({ entityId, onClose }: { entityId: string | null; onClose: () => void }) {
  const L = useL();
  const { data = [] } = useAudit({ entityId: entityId ?? undefined, limit: 100 }, entityId !== null);
  return (
    <Dialog open={entityId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{L.transactions.history}</DialogTitle>
        </DialogHeader>
        <div className="max-h-96 overflow-y-auto">
          <AuditList entries={data} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
