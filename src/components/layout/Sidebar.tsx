import {
  ArrowLeftRight,
  CalendarClock,
  ChartColumn,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Settings,
  Tags,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { useL } from "@/i18n";
import { cn } from "@/lib/utils";
import { type Section, useApp, useWorkspace } from "@/store/app";

const MAIN: { section: Section; icon: LucideIcon; hotkey?: string }[] = [
  { section: "dashboard", icon: LayoutDashboard, hotkey: "Ctrl+1" },
  { section: "transactions", icon: ArrowLeftRight, hotkey: "Ctrl+2" },
  { section: "accounts", icon: Wallet, hotkey: "Ctrl+3" },
  { section: "analytics", icon: ChartColumn, hotkey: "Ctrl+4" },
  { section: "budgets", icon: PiggyBank, hotkey: "Ctrl+5" },
  { section: "recurring", icon: CalendarClock, hotkey: "Ctrl+6" },
  { section: "goals", icon: Target, hotkey: "Ctrl+7" },
];

export function Sidebar() {
  const L = useL();
  const workspace = useWorkspace();
  const section = useApp((s) => s.section);
  const go = useApp((s) => s.go);
  const version = useApp((s) => s.appVersion);

  const secondary: { section: Section; icon: LucideIcon }[] = [
    ...(workspace.kind === "family" ? [{ section: "members" as const, icon: Users }] : []),
    { section: "categories", icon: Tags },
    { section: "settings", icon: Settings },
  ];

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <WorkspaceSwitcher />
      </div>
      <nav aria-label="Разделы" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {MAIN.map((item) => (
          <NavItem
            key={item.section}
            icon={item.icon}
            label={L.nav[item.section]}
            hotkey={item.hotkey}
            active={section === item.section}
            onClick={() => go(item.section)}
          />
        ))}
        <div className="my-2 h-px bg-sidebar-border" />
        {secondary.map((item) => (
          <NavItem
            key={item.section}
            icon={item.icon}
            label={L.nav[item.section]}
            active={section === item.section}
            onClick={() => go(item.section)}
          />
        ))}
      </nav>
      <div className="px-5 py-3 text-xs text-muted-foreground">
        {L.app.name} {version}
      </div>
    </aside>
  );
}

function NavItem({
  icon: Icon,
  label,
  hotkey,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  hotkey?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={hotkey}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn("size-4", active && "text-sidebar-primary")} />
      <span className="truncate">{label}</span>
    </button>
  );
}
