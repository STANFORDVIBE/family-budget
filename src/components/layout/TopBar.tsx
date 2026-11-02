import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, Eye, EyeOff, Plus, Search, Target, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { useApp } from "@/store/app";

export function TopBar() {
  const L = useL();
  const section = useApp((s) => s.section);
  const hidden = useApp((s) => s.settings?.hideAmounts ?? false);
  const open = useApp((s) => s.openTxDialog);

  async function toggleHidden() {
    const store = useApp.getState();
    store.setSettings(await api.updateSettings({ hideAmounts: !hidden }));
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-8">
      <h2 className="text-base">{L.nav[section]}</h2>
      <div className="flex-1" />
      <Button
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => useApp.getState().focusSearch()}
        title="Ctrl+F"
      >
        <Search />
        {L.common.search}
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={L.settings.hideAmounts}
            aria-pressed={hidden}
            onClick={() => void toggleHidden()}
          >
            {hidden ? <EyeOff /> : <Eye />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{L.settings.hideAmounts}</TooltipContent>
      </Tooltip>
      <div className="flex">
        <Button className="rounded-r-none" onClick={() => open({ mode: "create" })} title="Ctrl+N" data-testid="add-operation">
          <Plus />
          {L.quick.addOperation}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="rounded-l-none border-l border-primary-foreground/20 px-2" aria-label={L.common.more}>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => open({ mode: "create", kind: "expense" })}>
              <ArrowUpRight className="text-expense" />
              {L.quick.expense}
              <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open({ mode: "create", kind: "income" })}>
              <ArrowDownLeft className="text-income" />
              {L.quick.income}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => open({ mode: "create", kind: "transfer" })}>
              <ArrowLeftRight />
              {L.quick.transfer}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => useApp.getState().requestCreate("goal")}>
              <Target />
              {L.quick.goal}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => useApp.getState().requestCreate("account")}>
              <Wallet />
              {L.quick.account}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
