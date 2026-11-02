import { createElement } from "react";
import { iconFor } from "@/lib/icons";
import { cn } from "@/lib/utils";

/** Renders a stored icon key (lucide identifier). */
export function DynamicIcon({ name, className }: { name: string; className?: string }) {
  return createElement(iconFor(name), { className });
}

/** A coloured round badge with an icon: categories, accounts, goals. */
export function IconBadge({
  icon,
  color,
  size = "md",
  className,
}: {
  icon: string;
  color: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        size === "sm" && "size-6 [&_svg]:size-3.5",
        size === "md" && "size-8 [&_svg]:size-4",
        size === "lg" && "size-10 [&_svg]:size-5",
        className,
      )}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
      aria-hidden
    >
      <DynamicIcon name={icon} />
    </span>
  );
}
