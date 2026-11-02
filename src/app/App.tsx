import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Onboarding } from "@/features/onboarding/Onboarding";
import { Recovery } from "@/features/recovery/Recovery";
import { useL } from "@/i18n";
import { ru } from "@/i18n/ru";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { queryClient } from "@/lib/queries";
import type { Bootstrap } from "@/lib/types";
import { useApp } from "@/store/app";
import { useThemeStore } from "@/store/theme";

type Stage = { kind: "loading" } | { kind: "error"; message: string } | { kind: "recovery"; reason: string } | {
  kind: "onboarding";
} | { kind: "ready" };

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <Root />
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Root() {
  const L = useL();
  const [stage, setStage] = useState<Stage>({ kind: "loading" });
  const loadBootstrap = useApp((s) => s.loadBootstrap);
  const themePreference = useApp((s) => s.settings?.theme);

  const apply = useCallback(
    (data: Bootstrap) => {
      if (data.openError) {
        setStage({ kind: "recovery", reason: data.openError });
        return;
      }
      loadBootstrap(data);
      queryClient.clear();
      setStage(data.user && data.workspaces.length > 0 ? { kind: "ready" } : { kind: "onboarding" });
    },
    [loadBootstrap],
  );
  // The dictionary is not loaded yet when bootstrap fails: Russian is the safe choice
  const fail = useCallback((error: unknown) => setStage({ kind: "error", message: errorMessage(error, ru) }), []);
  const load = useCallback(() => api.bootstrap().then(apply, fail), [apply, fail]);

  useEffect(() => {
    void api.bootstrap().then(apply, fail);
  }, [apply, fail]);

  // The theme preference lives in the database; mirror it into the theme store once loaded
  useEffect(() => {
    if (themePreference) useThemeStore.getState().setPreference(themePreference);
  }, [themePreference]);

  switch (stage.kind) {
    case "loading":
      return <div className="flex h-full items-center justify-center text-muted-foreground">{L.app.loading}</div>;
    case "error":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="text-destructive">{stage.message}</p>
        </div>
      );
    case "recovery":
      return <Recovery reason={stage.reason} onRecovered={load} />;
    case "onboarding":
      return <Onboarding onDone={load} />;
    case "ready":
      return <AppShell onReload={load} />;
  }
}
