import { DatabaseBackup, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage, isCancelled } from "@/lib/errors";

/** Shown instead of the app when the database cannot be opened. Nothing is deleted here. */
export function Recovery({ reason, onRecovered }: { reason: string; onRecovered: () => void }) {
  const L = useL();
  const [busy, setBusy] = useState(false);

  async function restore() {
    setBusy(true);
    try {
      await api.recoverFromFile();
      toast.success(L.recovery.done);
      onRecovered();
    } catch (error) {
      if (!isCancelled(error)) toast.error(errorMessage(error, L));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning">
          <TriangleAlert className="size-7" />
        </span>
        <h1 className="text-xl">{L.recovery.title}</h1>
        <p className="text-muted-foreground">
          {reason === "unsupported_version" ? L.recovery.unsupported : L.recovery.openFailed}
        </p>
        <Button size="lg" onClick={restore} disabled={busy}>
          <DatabaseBackup />
          {L.recovery.restore}
        </Button>
      </div>
    </div>
  );
}
