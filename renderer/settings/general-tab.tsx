import { useEffect, useState } from "react";
import {
  Button,
  Field,
  FieldContent,
  FieldLabel,
  FieldSet,
  Label,
  RadioGroup,
  RadioGroupItem,
  Status,
  Switch,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import type { CalendarRange, Density, DetailView, LaunchView } from "@main/shared-types";

import { useSettingsEditor } from "../lib/settings";
import { isRendererDemoMode } from "../lib/demo";
import { CALENDAR_OPTIONS } from "../lib/calendar-range-options";
import { useStartAtLogin } from "../lib/use-start-at-login";
import { AccentPicker } from "./accent-picker";
import { SettingSelect } from "./setting-select";

const LAUNCH_OPTIONS: { value: LaunchView; label: string }[] = [
  { value: "today", label: "Agenda · Today" },
  { value: "tasks", label: "Google Tasks" },
  { value: "reminders", label: "Apple Reminders" },
  { value: "mail", label: "Mail" },
  { value: "calendar", label: "Agenda · Calendar range" },
  { value: "assistant", label: "Assistant" },
  { value: "review", label: "Weekly Review" },
];

const REFRESH_OPTIONS = [
  { value: "0", label: "Manually" },
  { value: "5", label: "Every 5 minutes" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
];

const MAIL_OPTIONS = [
  { value: "10", label: "10 messages" },
  { value: "25", label: "25 messages" },
  { value: "50", label: "50 messages" },
];

export function GeneralTab() {
  const { settings, edit } = useSettingsEditor();
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);
  const startAtLogin = useStartAtLogin();

  const refreshThemeInfo = async () => {
    try {
      setThemeInfo(await window.glazeAPI.nativeTheme.getInfo());
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    }
  };

  useEffect(() => {
    void refreshThemeInfo();
  }, []);

  const handleThemeChange = async (value: string) => {
    if (isRendererDemoMode()) {
      toast.error("Theme changes are unavailable in screenshot demo mode.");
      return;
    }
    try {
      await window.glazeAPI.nativeTheme.setThemeSource(value as "system" | "light" | "dark");
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  return (
    <>
      <FieldSet title="Appearance">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="theme">Theme</FieldLabel>
          </FieldContent>
          <RadioGroup
            value={themeInfo?.themeSource ?? "system"}
            onValueChange={handleThemeChange}
            orientation="horizontal"
          >
            <Label>
              <RadioGroupItem value="system" />
              Auto
            </Label>
            <Label>
              <RadioGroupItem value="light" />
              Light
            </Label>
            <Label>
              <RadioGroupItem value="dark" />
              Dark
            </Label>
          </RadioGroup>
        </Field>
        {settings ? (
          <>
            <Field label="Accent color" description="Tints buttons, selections, and highlights.">
              <AccentPicker
                value={settings.general.accent}
                onChange={(accent) =>
                  edit((draft) => {
                    draft.general.accent = accent;
                  })
                }
              />
            </Field>
            <Field label="Density" description="Compact fits more items on screen.">
              <RadioGroup
                value={settings.general.density}
                onValueChange={(value) =>
                  edit((draft) => {
                    draft.general.density = value as Density;
                  })
                }
                orientation="horizontal"
                aria-label="Density"
              >
                <Label>
                  <RadioGroupItem value="default" />
                  Default
                </Label>
                <Label>
                  <RadioGroupItem value="compact" />
                  Compact
                </Label>
              </RadioGroup>
            </Field>
            <Field
              label="Open details in"
              description="How tasks, reminders, and events open when you click them."
            >
              <RadioGroup
                value={settings.general.detailView}
                onValueChange={(value) =>
                  edit((draft) => {
                    draft.general.detailView = value as DetailView;
                  })
                }
                orientation="horizontal"
                aria-label="Open details in"
              >
                <Label>
                  <RadioGroupItem value="dialog" />
                  Pop-up
                </Label>
                <Label>
                  <RadioGroupItem value="inline" />
                  Inline
                </Label>
                <Label>
                  <RadioGroupItem value="sidebar" />
                  Side panel
                </Label>
              </RadioGroup>
            </Field>
          </>
        ) : null}
      </FieldSet>

      {settings ? (
        <>
          <FieldSet title="Startup & Refresh">
            <Field
              label="Start at login"
              description={
                startAtLogin.isError
                  ? undefined
                  : startAtLogin.data?.status === "requires-approval"
                    ? "Allow DayBoard in System Settings → General → Login Items."
                    : "Open DayBoard when you sign in to your Mac."
              }
              error={startAtLogin.isError ? "Could not read the macOS login setting." : undefined}
            >
              {startAtLogin.isError ? (
                <Button size="small" onClick={() => void startAtLogin.refetch()}>
                  Retry
                </Button>
              ) : null}
              <Switch
                id="start-at-login"
                aria-label="Start at login"
                checked={startAtLogin.data?.openAtLogin ?? false}
                disabled={
                  startAtLogin.isPending ||
                  startAtLogin.isError ||
                  startAtLogin.setOpenAtLogin.isPending
                }
                onCheckedChange={(openAtLogin) => startAtLogin.setOpenAtLogin.mutate(openAtLogin)}
              />
            </Field>
            <Field label="Open at launch" description="The view shown when the dashboard opens.">
              <SettingSelect
                label="Open at launch"
                value={settings.general.launchView}
                options={LAUNCH_OPTIONS}
                onChange={(value) =>
                  edit((draft) => {
                    draft.general.launchView = value as LaunchView;
                  })
                }
              />
            </Field>
            <Field
              label="Refresh automatically"
              description="How often to check your sources for changes."
            >
              <SettingSelect
                label="Refresh automatically"
                value={String(settings.general.refreshMinutes)}
                options={REFRESH_OPTIONS}
                onChange={(value) =>
                  edit((draft) => {
                    draft.general.refreshMinutes = Number(value);
                  })
                }
              />
            </Field>
          </FieldSet>

          <FieldSet title="Data">
            <Field label="Inbox size" description="How many recent Gmail inbox messages to load.">
              <SettingSelect
                label="Inbox size"
                value={String(settings.mail.maxMessages)}
                options={MAIL_OPTIONS}
                onChange={(value) =>
                  edit((draft) => {
                    draft.mail.maxMessages = Number(value);
                  })
                }
              />
            </Field>
            <Field
              label="Calendar range"
              description="The default date range for Calendar and the calendar context used by Assistant."
            >
              <SettingSelect
                label="Calendar range"
                value={settings.calendar.range}
                options={CALENDAR_OPTIONS}
                onChange={(value) =>
                  edit((draft) => {
                    draft.calendar.range = value as CalendarRange;
                  })
                }
              />
            </Field>
          </FieldSet>
        </>
      ) : (
        <Status variant="loading">Loading settings…</Status>
      )}
    </>
  );
}
