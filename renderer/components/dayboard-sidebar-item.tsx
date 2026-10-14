import { Badge, SidebarListItem, Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import { CircleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { SourceColor } from "@main/shared-types";

const SOURCE_TINT: Record<SourceColor, string> = {
  blue: "bg-support-blue/12",
  green: "bg-support-green/12",
  orange: "bg-support-orange/12",
  red: "bg-support-red/12",
  purple: "bg-support-purple/12",
  magenta: "bg-support-magenta/12",
  yellow: "bg-support-yellow/12",
};

export function DayBoardSidebarItem({
  icon,
  title,
  subtitle,
  accessory,
  selected = false,
  sourceColor,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  accessory?: ReactNode;
  selected?: boolean;
  sourceColor?: SourceColor;
  onClick: () => void;
}) {
  return (
    <SidebarListItem
      className="min-h-[var(--density-list-row)]"
      icon={
        <span
          aria-hidden="true"
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-control text-secondary",
            sourceColor ? SOURCE_TINT[sourceColor] : "bg-control-subtle",
          )}
        >
          {icon}
        </span>
      }
      title={
        <Text variant={selected ? "strong" : "regular"} color="inherit" truncate title={title}>
          {title}
        </Text>
      }
      subtitle={
        subtitle ? (
          <Text variant="small" color="secondary" truncate title={subtitle}>
            {subtitle}
          </Text>
        ) : undefined
      }
      accessory={accessory}
      selected={selected}
      aria-current={selected ? "page" : undefined}
      onClick={onClick}
    />
  );
}

export function DayBoardSidebarCount({
  count,
  label,
  overdue = false,
}: {
  count: number;
  label: string;
  overdue?: boolean;
}) {
  return (
    <Badge
      color={overdue ? "red" : "secondary"}
      size="small"
      className="min-w-6 shrink-0 justify-center tabular-nums"
      title={label}
      role="img"
      aria-label={label}
    >
      {overdue ? <CircleAlertIcon aria-hidden="true" /> : null}
      {count}
    </Badge>
  );
}
