import { useEffect, useState } from "react";
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldSet,
  Label,
  RadioGroup,
  RadioGroupItem,
  Status,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import type { LaunchView } from "@main/shared-types";

import { useSettingsEditor } from "../lib/settings";
import { SettingSelect } from "./setting-select";

const LAUNCH_OPTIONS: { value: LaunchView; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tasks", label: "Google Tasks" },
  { value: "reminders", label: "Reminders" },
  { value: "mail", label: "Mail" },
  { value: "calendar", label: "Calendar" },
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

const CALENDAR_OPTIONS = [
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
];

export function GeneralTab() {
  const { settings, edit } = useSettingsEditor();
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

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
      </FieldSet>

      {settings ? (
        <>
          <FieldSet title="Startup & Refresh">
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
            <Field label="Calendar range" description="How far ahead the calendar looks.">
              <SettingSelect
                label="Calendar range"
                value={String(settings.calendar.daysAhead)}
                options={CALENDAR_OPTIONS}
                onChange={(value) =>
                  edit((draft) => {
                    draft.calendar.daysAhead = Number(value);
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
