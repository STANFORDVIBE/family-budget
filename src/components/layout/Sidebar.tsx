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
import { useState } from "react";
import { toast } from "sonner";
import { WorkspaceSwitcher } from "@/components/layout/WorkspaceSwitcher";
import { useL } from "@/i18n";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { MAIN_SECTIONS, SECONDARY_SECTIONS, moveTo, orderSections } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { type Section, useApp, useWorkspace } from "@/store/app";

const ICONS: Record<Section, LucideIcon> = {
  dashboard: LayoutDashboard,
  transactions: ArrowLeftRight,
  accounts: Wallet,
  analytics: ChartColumn,
  budgets: PiggyBank,
  recurring: CalendarClock,
  goals: Target,
  members: Users,
  categories: Tags,
  settings: Settings,
};

type Groups = { main: Section[]; secondary: Section[] };
type DragProps = { draggable: boolean } & Pick<
  React.DOMAttributes<HTMLButtonElement>,
  "onDragStart" | "onDragOver" | "onDrop" | "onDragEnd"
>;

export function Sidebar() {
  const L = useL();
  const workspace = useWorkspace();
  const section = useApp((s) => s.section);
  const go = useApp((s) => s.go);
  const version = useApp((s) => s.appVersion);
  const saved = useApp((s) => s.settings?.navOrder ?? []);
  // While dragging, the order lives here and is saved when the drag ends.
  const [draft, setDraft] = useState<Groups | null>(null);
  const [dragging, setDragging] = useState<Section | null>(null);

  const groups: Groups = draft ?? {
    main: orderSections(MAIN_SECTIONS, saved),
    secondary: orderSections(SECONDARY_SECTIONS, saved),
  };
  const groupOf = (s: Section): keyof Groups => (MAIN_SECTIONS.includes(s) ? "main" : "secondary");

  async function save(order: Section[]) {
    const store = useApp.getState();
    const before = store.settings;
    if (
      !before ||
      order.join() === [...orderSections(MAIN_SECTIONS, saved), ...orderSections(SECONDARY_SECTIONS, saved)].join()
    )
      return;
    store.setSettings({ ...before, navOrder: order });
    try {
      useApp.getState().setSettings(await api.updateSettings({ navOrder: order }));
    } catch (error) {
      useApp.getState().setSettings(before);
      toast.error(errorMessage(error, L));
    }
  }

  // Each item is dragged within its own group; the list rearranges live under the pointer.
  const dragProps = (item: Section): DragProps => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item);
      setDragging(item);
      setDraft(groups);
    },
    onDragOver: (e) => {
      if (!dragging || !draft || groupOf(dragging) !== groupOf(item)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const key = groupOf(item);
      const next = moveTo(draft[key], dragging, item);
      if (next !== draft[key]) setDraft({ ...draft, [key]: next });
    },
    onDrop: (e) => e.preventDefault(),
    onDragEnd: () => {
      if (draft) void save([...draft.main, ...draft.secondary]);
      setDraft(null);
      setDragging(null);
    },
  });

  const secondary = groups.secondary.filter((s) => s !== "members" || workspace.kind === "family");

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="p-3">
        <WorkspaceSwitcher />
      </div>
      <nav aria-label="Разделы" className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
        {groups.main.map((item, i) => (
          <NavItem
            key={item}
            icon={ICONS[item]}
            label={L.nav[item]}
            hotkey={`Ctrl+${i + 1}`}
            active={section === item}
            dragged={dragging === item}
            onClick={() => go(item)}
            {...dragProps(item)}
          />
        ))}
        <div className="my-2 h-px bg-sidebar-border" />
        {secondary.map((item) => (
          <NavItem
            key={item}
            icon={ICONS[item]}
            label={L.nav[item]}
            active={section === item}
            dragged={dragging === item}
            onClick={() => go(item)}
            {...dragProps(item)}
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
  dragged,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  hotkey?: string;
  active: boolean;
  dragged: boolean;
  onClick: () => void;
} & DragProps) {
  return (
    <button
      type="button"
      {...rest}
      aria-current={active ? "page" : undefined}
      data-testid={`nav-${label}`}
      title={hotkey}
      className={cn(
        dragged && "opacity-40",
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
