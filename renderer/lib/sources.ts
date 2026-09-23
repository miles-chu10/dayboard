import type { ComponentType } from "react";
import type { AppSettings, SourceColor, SourceId } from "@main/shared-types";

import {
  AppleRemindersLogo,
  GmailLogo,
  GoogleCalendarLogo,
  GoogleTasksLogo,
} from "../components/source-logos";
import { useSettings } from "./settings";

export { sourceColorVar } from "./source-colors";

export const SOURCE_IDS: SourceId[] = ["tasks", "reminders", "mail", "calendar"];

export const SOURCE_META: Record<
  SourceId,
  {
    label: string;
    route: "/tasks" | "/reminders" | "/mail" | "/calendar";
    icon: ComponentType<{ className?: string }>;
  }
> = {
  tasks: { label: "Google Tasks", route: "/tasks", icon: GoogleTasksLogo },
  reminders: { label: "Apple Reminders", route: "/reminders", icon: AppleRemindersLogo },
  mail: { label: "Gmail", route: "/mail", icon: GmailLogo },
  calendar: { label: "Calendar", route: "/calendar", icon: GoogleCalendarLogo },
};

const DEFAULT_COLORS: Record<SourceId, SourceColor> = {
  tasks: "blue",
  reminders: "orange",
  mail: "red",
  calendar: "green",
};

export const COLOR_OPTIONS: { value: SourceColor; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "green", label: "Green" },
  { value: "orange", label: "Orange" },
  { value: "red", label: "Red" },
  { value: "purple", label: "Purple" },
  { value: "magenta", label: "Pink" },
  { value: "yellow", label: "Yellow" },
];

// Literal class names so Tailwind generates every variant.
export const COLOR_CLASS: Record<SourceColor, { bg: string; text: string; border: string }> = {
  blue: { bg: "bg-support-blue", text: "text-support-blue", border: "border-support-blue" },
  green: { bg: "bg-support-green", text: "text-support-green", border: "border-support-green" },
  orange: { bg: "bg-support-orange", text: "text-support-orange", border: "border-support-orange" },
  red: { bg: "bg-support-red", text: "text-support-red", border: "border-support-red" },
  purple: { bg: "bg-support-purple", text: "text-support-purple", border: "border-support-purple" },
  magenta: {
    bg: "bg-support-magenta",
    text: "text-support-magenta",
    border: "border-support-magenta",
  },
  yellow: { bg: "bg-support-yellow", text: "text-support-yellow", border: "border-support-yellow" },
};

export function sourceColor(settings: AppSettings | undefined, source: SourceId): SourceColor {
  return settings?.sources[source].color ?? DEFAULT_COLORS[source];
}

export function useSourceColor(source: SourceId): SourceColor {
  return sourceColor(useSettings().data, source);
}
