import * as React from "react";
import { Bolt, Folder, Image, Paperclip, Settings, Sparkles, Trash2, Rabbit } from "lucide-react";

/**
 * Glaze menu items pass SF Symbol names for `icon`. There is no SF Symbols renderer on the web, so
 * this maps the small set of symbol names DayBoard actually uses to an equivalent Lucide icon;
 * anything unmapped renders nothing rather than a broken glyph.
 */
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  "bolt.fill": Bolt,
  gear: Settings,
  paperclip: Paperclip,
  photo: Image,
  trash: Trash2,
  "folder.fill": Folder,
  sparkles: Sparkles,
  "hare.fill": Rabbit,
};

export type MenuItemColor =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "mint"
  | "teal"
  | "cyan"
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "brown"
  | "gray"
  | "primary"
  | "secondary"
  | (string & {});

const COLOR_CLASS: Record<string, string> = {
  red: "text-support-red",
  orange: "text-support-orange",
  yellow: "text-support-yellow",
  green: "text-support-green",
  blue: "text-support-blue",
  purple: "text-support-purple",
  pink: "text-support-magenta",
  gray: "text-tertiary",
  primary: "text-primary",
  secondary: "text-secondary",
};

export function menuItemColorClass(color?: MenuItemColor): string | undefined {
  if (!color) return undefined;
  return COLOR_CLASS[color] ?? (color.startsWith("#") ? undefined : undefined);
}

export function menuItemColorStyle(color?: MenuItemColor): React.CSSProperties | undefined {
  return color?.startsWith("#") ? { color } : undefined;
}

export type NativeMenuIcon = string;

export function MenuIcon({ icon, className }: { icon?: NativeMenuIcon; className?: string }) {
  const Icon = icon ? ICON_MAP[icon] : undefined;
  if (!Icon) return null;
  return <Icon className={className ?? "size-4"} />;
}
