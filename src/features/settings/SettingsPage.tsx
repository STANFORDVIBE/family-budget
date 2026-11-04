import {
  CircleCheck,
  DatabaseBackup,
  Download,
  FileDown,
  FolderOpen,
  HardDrive,
  Monitor,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Field, Page, PageHeader } from "@/components/common/layout";
import { CurrencySelect, SimpleSelect } from "@/components/common/pickers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { AuditList } from "@/features/audit/AuditList";
import { fmt, useL } from "@/i18n";
import { api } from "@/lib/api";
import { dayLabel, formatDate, todayIso } from "@/lib/dates";
import { errorMessage, isCancelled } from "@/lib/errors";
import { useAppMutation, useAudit, useBackupStatus, useRates, useWsMutation } from "@/lib/queries";
import { displayRate, normalizeRate } from "@/lib/rates";
import type { BackupFile, IntegrityReport, Settings, UpdateInfo } from "@/lib/types";
import { useApp, useWorkspace } from "@/store/app";

const dateTime = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" });

export function SettingsPage({ onReload }: { onReload: () => Promise<void> }) {
  const L = useL();
  return (
    <Page className="max-w-4xl">
      <PageHeader title={L.settings.title} />
      <General />
      <WorkspaceSettings />
      <Rates />
      <Backups onReload={onReload} />
      <Integrity />
      <ExportData />
      <Audit />
      <About />
    </Page>
  );
}

function useSettingsUpdate() {
  const L = useL();
  return async (patch: Partial<Omit<Settings, "backupDir">>) => {
    try {
      useApp.getState().setSettings(await api.updateSettings(patch));
    } catch (error) {
      toast.error(errorMessage(error, L));
    }
  };
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="gap-4">{children}</CardContent>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General() {
  const L = useL();
  const settings = useApp((s) => s.settings);
  const user = useApp((s) => s.user);
  const update = useSettingsUpdate();
  const [name, setName] = useState(user?.name ?? "");
  if (!settings) return null;

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user?.name) return;
    try {
      useApp.getState().setUser(await api.renameUser(trimmed));
      toast.success(L.common.saved);
    } catch (error) {
      toast.error(errorMessage(error, L));
    }
  }

  return (
    <Section title={L.settings.general}>
      <Row label={L.settings.userName}>
        <Input
          className="w-60"
          aria-label={L.settings.userName}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void saveName()}
          onKeyDown={(e) => e.key === "Enter" && void saveName()}
        />
      </Row>
      <Row label={L.settings.theme}>
        <SegmentedControl
          aria-label={L.settings.theme}
          value={settings.theme}
          onValueChange={(theme) => void update({ theme })}
          options={[
            { value: "light", label: L.settings.themeLight, icon: Sun },
            { value: "dark", label: L.settings.themeDark, icon: Moon },
            { value: "system", label: L.settings.themeSystem, icon: Monitor },
          ]}
        />
      </Row>
      <Row label={L.settings.language}>
        <SimpleSelect
          aria-label={L.settings.language}
          className="w-48"
          value={settings.language}
          onChange={(language) => void update({ language })}
          options={[
            { value: "ru", label: "Русский" },
            { value: "en", label: L.settings.languageEn },
          ]}
        />
      </Row>
      <Row label={L.settings.dateFormat}>
        <SimpleSelect
          aria-label={L.settings.dateFormat}
          className="w-48"
          value={settings.dateFormat}
          onChange={(dateFormat) => void update({ dateFormat })}
          options={(["dd.MM.yyyy", "yyyy-MM-dd", "MM/dd/yyyy"] as const).map((f) => ({
            value: f,
            label: formatDate(todayIso(), f),
          }))}
        />
      </Row>
      <Row label={L.settings.numberFormat}>
        <SimpleSelect
          aria-label={L.settings.numberFormat}
          className="w-48"
          value={settings.numberFormat}
          onChange={(numberFormat) => void update({ numberFormat })}
          options={[
            { value: "space_comma", label: "1 234 567,89" },
            { value: "comma_dot", label: "1,234,567.89" },
            { value: "dot_comma", label: "1.234.567,89" },
          ]}
        />
      </Row>
      <Row label={L.settings.hideAmounts} hint={L.settings.hideAmountsHint}>
        <Switch
          aria-label={L.settings.hideAmounts}
          checked={settings.hideAmounts}
          onCheckedChange={(hideAmounts) => void update({ hideAmounts })}
        />
      </Row>
    </Section>
  );
}

function WorkspaceSettings() {
  const L = useL();
  const workspace = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [currency, setCurrency] = useState(workspace.baseCurrency);
  const dirty = name.trim() !== workspace.name || currency !== workspace.baseCurrency;

  async function save() {
    try {
      const updated = await api.updateWorkspace(workspace.id, { name: name.trim(), baseCurrency: currency });
      const store = useApp.getState();
      store.setWorkspaces(store.workspaces.map((w) => (w.id === updated.id ? updated : w)));
      toast.success(L.common.saved);
    } catch (error) {
      setCurrency(workspace.baseCurrency);
      toast.error(errorMessage(error, L));
    }
  }

  return (
    <Section title={L.settings.workspace}>
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.settings.workspaceName} htmlFor="ws-set-name">
          <Input id="ws-set-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={L.settings.baseCurrency} htmlFor="ws-set-currency" hint={L.settings.baseLocked}>
          <CurrencySelect id="ws-set-currency" value={currency} onChange={setCurrency} />
        </Field>
      </div>
      <div>
        <Button disabled={!dirty || !name.trim()} onClick={() => void save()}>
          {L.common.save}
        </Button>
      </div>
    </Section>
  );
}

function Rates() {
  const L = useL();
  const workspace = useWorkspace();
  const { data: rates = [] } = useRates();
  const decimal = useApp((s) => (s.settings?.numberFormat === "comma_dot" ? "." : ","));
  const [adding, setAdding] = useState(false);
  const remove = useWsMutation((workspaceId, id: string) => api.deleteRate({ workspaceId, id }), {
    success: L.common.deleted,
  });

  return (
    <Section title={L.settings.rates} description={L.settings.ratesHint}>
      {rates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{L.settings.noRates}</p>
      ) : (
        <ul className="flex max-h-72 flex-col divide-y overflow-y-auto">
          {rates.map((r) => (
            <li key={r.id} className="group flex items-center gap-3 py-1.5 text-sm">
              <span className="w-28 text-muted-foreground">{dayLabel(r.rateDate)}</span>
              <span className="flex-1 tabular">
                1 {r.fromCurrency} = {displayRate(r.rate, decimal)} {r.toCurrency}
              </span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={L.common.delete}
                className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => remove.mutate(r.id)}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="outline" onClick={() => setAdding(true)}>
          <Plus />
          {L.settings.addRate}
        </Button>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>{adding && <RateForm base={workspace.baseCurrency} onClose={() => setAdding(false)} />}</DialogContent>
      </Dialog>
    </Section>
  );
}

function RateForm({ base, onClose }: { base: string; onClose: () => void }) {
  const L = useL();
  const [currency, setCurrency] = useState(base === "USD" ? "EUR" : "USD");
  const [rate, setRate] = useState("");
  const [date, setDate] = useState(todayIso);
  const normalized = normalizeRate(rate);
  const save = useWsMutation(
    (workspaceId, _: void) =>
      api.upsertRate({ workspaceId, input: { currency, rate: normalized ?? "", rateDate: date } }),
    { success: L.common.saved, onSuccess: onClose },
  );
  const valid = normalized !== null && currency !== base && date !== "";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <DialogHeader>
        <DialogTitle>{L.settings.addRate}</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field label={L.common.currency} htmlFor="rate-currency">
          <CurrencySelect id="rate-currency" value={currency} onChange={setCurrency} />
        </Field>
        <Field label={L.common.date} htmlFor="rate-date">
          <Input id="rate-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field
          label={fmt(L.txForm.rate, { base })}
          htmlFor="rate-value"
          className="col-span-2"
          hint={fmt(L.txForm.rateHint, { from: currency, base })}
        >
          <Input id="rate-value" inputMode="decimal" autoFocus value={rate} onChange={(e) => setRate(e.target.value)} />
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

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toString().replace(".", ",")} МБ`;
}

function Backups({ onReload }: { onReload: () => Promise<void> }) {
  const L = useL();
  const { data: status } = useBackupStatus();
  const update = useSettingsUpdate();
  const [restoring, setRestoring] = useState<BackupFile | null>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const client = useQueryClient();
  const refreshBackup = () => client.invalidateQueries({ queryKey: ["backup"] });

  const create = useAppMutation(() => api.createBackup(), {
    success: (name) => fmt(L.settings.backupCreated, { name }),
  });
  const chooseFolder = useAppMutation(() => api.chooseBackupFolder());
  const resetFolder = useAppMutation(() => api.resetBackupFolder());

  async function afterRestore(safety: string) {
    toast.success(fmt(L.settings.restored, { name: safety }));
    await onReload();
  }
  const restore = useAppMutation((name: string) => api.restoreBackup(name), {
    onSuccess: (safety) => {
      setRestoring(null);
      void afterRestore(safety);
    },
  });
  async function restoreFromFile() {
    try {
      await afterRestore(await api.restoreBackupFromFile());
    } catch (error) {
      if (!isCancelled(error)) toast.error(errorMessage(error, L));
    }
  }

  if (!status) return null;
  const keepValue = keep ?? String(status.keep);

  return (
    <Section title={L.settings.backups}>
      <Row label={L.settings.autoBackup}>
        <Switch
          aria-label={L.settings.autoBackup}
          checked={status.autoBackup}
          onCheckedChange={async (autoBackup) => {
            await update({ autoBackup });
            void refreshBackup();
          }}
        />
      </Row>
      <Row label={L.settings.keep}>
        <Input
          type="number"
          className="w-24"
          min={3}
          max={200}
          aria-label={L.settings.keep}
          value={keepValue}
          onChange={(e) => setKeep(e.target.value)}
          onBlur={async () => {
            const n = Math.trunc(Number(keepValue));
            if (n !== status.keep && Number.isFinite(n)) {
              await update({ backupKeep: n });
              void refreshBackup();
            }
            setKeep(null);
          }}
        />
      </Row>
      <div className="flex flex-col gap-2">
        <div className="text-sm">{L.settings.folder}</div>
        <div className="flex items-center gap-2">
          <code data-selectable className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 text-xs">
            {status.dir}
          </code>
          {!status.isCustomDir && <Badge variant="secondary">{L.settings.defaultFolder}</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => chooseFolder.mutate(undefined)}>
            <FolderOpen />
            {L.settings.chooseFolder}
          </Button>
          {status.isCustomDir && (
            <Button variant="outline" size="sm" onClick={() => resetFolder.mutate(undefined)}>
              <RotateCcw />
              {L.settings.defaultFolder}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => void api.openBackupFolder().catch(() => undefined)}>
            <HardDrive />
            {L.settings.openFolder}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => create.mutate(undefined)} disabled={create.isPending} data-testid="backup-now">
          <DatabaseBackup />
          {L.settings.backupNow}
        </Button>
        <Button variant="outline" onClick={() => void restoreFromFile()}>
          {L.settings.restoreFromFile}
        </Button>
        <span className="text-xs text-muted-foreground">
          {fmt(L.settings.lastBackup, {
            when: status.lastBackupAt ? dateTime.format(status.lastBackupAt) : L.settings.never,
          })}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-sm">{L.settings.files}</div>
        {status.files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{L.settings.noFiles}</p>
        ) : (
          <ul className="flex max-h-64 flex-col divide-y overflow-y-auto">
            {status.files.map((f) => (
              <li key={f.name} className="group flex items-center gap-3 py-1.5 text-sm">
                <span className="min-w-0 flex-1 truncate" data-selectable>
                  {f.name}
                </span>
                {f.automatic && <Badge variant="secondary">{L.settings.auto}</Badge>}
                <span className="w-36 text-right text-xs text-muted-foreground">{dateTime.format(f.modifiedAt)}</span>
                <span className="w-16 text-right text-xs text-muted-foreground tabular">{formatSize(f.size)}</span>
                <Button variant="outline" size="xs" onClick={() => setRestoring(f)}>
                  {L.settings.restore}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
        title={L.settings.restoreTitle}
        text={restoring ? fmt(L.settings.restoreText, { name: restoring.name }) : undefined}
        confirmLabel={L.settings.restore}
        destructive={false}
        pending={restore.isPending}
        onConfirm={() => restoring && restore.mutate(restoring.name)}
      />
    </Section>
  );
}

function Integrity() {
  const L = useL();
  const [report, setReport] = useState<IntegrityReport | null>(null);
  const check = useAppMutation(() => api.checkIntegrity(), { onSuccess: setReport });
  return (
    <Section title={L.settings.integrity}>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => check.mutate(undefined)} disabled={check.isPending}>
          <ShieldCheck />
          {L.settings.integrityRun}
        </Button>
        {report &&
          (report.ok ? (
            <span className="flex items-center gap-1.5 text-sm text-success">
              <ShieldCheck className="size-4" />
              {L.settings.integrityOk}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
              <TriangleAlert className="size-4" />
              {L.settings.integrityIssues}
            </span>
          ))}
      </div>
      {report && !report.ok && (
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          {report.issues.map(([issue, count]) => (
            <li key={issue}>
              {issue}: {count}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ExportData() {
  const L = useL();
  const exportJson = useWsMutation((workspaceId, _: void) => api.exportWorkspace({ workspaceId }), {
    success: (name) => fmt(L.settings.exported, { name }),
  });
  return (
    <Section title={L.settings.export} description={L.settings.exportHint}>
      <div>
        <Button variant="outline" onClick={() => exportJson.mutate()} disabled={exportJson.isPending}>
          <FileDown />
          {L.settings.exportWorkspace}
        </Button>
      </div>
    </Section>
  );
}

function Audit() {
  const L = useL();
  const { data = [] } = useAudit({ limit: 50 });
  return (
    <Section title={L.settings.audit} description={L.settings.auditHint}>
      <div className="max-h-80 overflow-y-auto">
        <AuditList entries={data} />
      </div>
    </Section>
  );
}

function About() {
  const L = useL();
  const version = useApp((s) => s.appVersion);
  // undefined: not checked yet, null: already the latest version
  const [found, setFound] = useState<UpdateInfo | null | undefined>(undefined);
  const check = useAppMutation(() => api.checkUpdate(), { onSuccess: setFound });
  // On success the app exits and the installer restarts it, so only errors come back here.
  const install = useAppMutation(() => api.installUpdate());
  return (
    <Section title={L.settings.about}>
      <p className="text-sm">
        {L.app.name} · {fmt(L.settings.version, { v: version })}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => check.mutate(undefined)} disabled={check.isPending || install.isPending}>
          <RefreshCw className={check.isPending ? "animate-spin" : undefined} />
          {L.settings.checkUpdate}
        </Button>
        {found === null && (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <CircleCheck className="size-4" />
            {L.settings.upToDate}
          </span>
        )}
        {found && (
          <>
            <span className="text-sm">{fmt(L.settings.updateAvailable, { v: found.version })}</span>
            <Button onClick={() => install.mutate(undefined)} disabled={install.isPending}>
              <Download />
              {install.isPending ? L.settings.installingUpdate : L.settings.installUpdate}
            </Button>
          </>
        )}
      </div>
      {found && <p className="text-xs text-muted-foreground">{L.settings.updateHint}</p>}
      <p className="text-sm text-muted-foreground">{L.settings.privacy}</p>
    </Section>
  );
}
