import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Field, FieldSet, Switch } from "@renderer/ui";

import {
  acceleratorFromKeyEvent,
  formatAccelerator,
  validateAccelerator,
} from "@shared/accelerator";
import { invoke } from "../lib/ipc";
import { useSettingsEditor } from "../lib/settings";
import { SettingSelect } from "./setting-select";

interface HotkeyStatus {
  accelerator: string;
  enabled: boolean;
  registered: boolean;
  conflict: string | null;
}

const hotkeyStatusKey = ["system", "hotkey-status"] as const;

function useHotkeyStatus() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("system:hotkeyStatus", (status) =>
        queryClient.setQueryData(hotkeyStatusKey, status as HotkeyStatus),
      ),
    [queryClient],
  );
  return useQuery({
    queryKey: hotkeyStatusKey,
    queryFn: () => invoke<HotkeyStatus>("system:hotkeyStatus"),
  });
}

function suspendHotkey(suspended: boolean): void {
  void invoke("system:suspendHotkey", { suspended }).catch(() => undefined);
}

function ShortcutRecorder({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (accelerator: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useHotkeyStatus().data;

  // Never leave the global shortcut switched off when this control goes away mid-recording.
  useEffect(() => () => suspendHotkey(false), []);

  function stop() {
    setRecording(false);
    suspendHotkey(false);
  }

  const problem =
    error ?? (status?.enabled && status.accelerator === value ? status.conflict : null);
  return (
    <Field
      label="Shortcut"
      description={
        recording
          ? "Press the new shortcut, or Esc to cancel."
          : "Opens Quick Capture over any app, including full-screen apps."
      }
      error={problem ?? undefined}
    >
      <Button
        size="small"
        aria-label={`Quick Capture shortcut, ${formatAccelerator(value)}. Press to record a new one.`}
        disabled={disabled}
        onClick={() => {
          setError(null);
          setRecording(true);
          suspendHotkey(true);
        }}
        onBlur={() => {
          if (recording) stop();
        }}
        onKeyDown={(event) => {
          if (!recording) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === "Escape") return stop();
          const accelerator = acceleratorFromKeyEvent(event.nativeEvent);
          if (!accelerator) return;
          const valid = validateAccelerator(accelerator);
          if (!valid.ok) {
            setError(valid.reason);
            return;
          }
          setError(null);
          onChange(accelerator);
          stop();
        }}
      >
        {recording ? "Recording…" : formatAccelerator(value)}
      </Button>
    </Field>
  );
}

export function SystemPanelsSettings() {
  const { settings, edit } = useSettingsEditor();
  if (!settings) return null;
  const quickCapture = settings.system.quickCapture;
  return (
    <FieldSet title="Menu Bar & Shortcuts">
      <Field
        label="Quick Capture"
        description="Add a task, reminder or event from anywhere with a keyboard shortcut."
      >
        <Switch
          id="quick-capture-enabled"
          aria-label="Quick Capture"
          checked={quickCapture.enabled}
          onCheckedChange={(enabled) =>
            edit((draft) => {
              draft.system.quickCapture.enabled = enabled;
            })
          }
        />
      </Field>
      <ShortcutRecorder
        value={quickCapture.hotkey}
        disabled={!quickCapture.enabled}
        onChange={(hotkey) =>
          edit((draft) => {
            draft.system.quickCapture.hotkey = hotkey;
          })
        }
      />
      <Field
        label="Menu bar icon"
        description="Today's items, your next meeting and recent captures, one click away."
      >
        <Switch
          id="menu-bar-enabled"
          aria-label="Menu bar icon"
          checked={settings.system.menuBar.enabled}
          onCheckedChange={(enabled) =>
            edit((draft) => {
              draft.system.menuBar.enabled = enabled;
            })
          }
        />
      </Field>
    </FieldSet>
  );
}

const NOTIFY_OPTIONS = [
  { value: "1", label: "1 minute before" },
  { value: "2", label: "2 minutes before" },
  { value: "5", label: "5 minutes before" },
  { value: "10", label: "10 minutes before" },
];

const notificationStatusKey = ["system", "notification-status"] as const;

function useNotificationStatus() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("system:notificationStatus", (status) =>
        queryClient.setQueryData(notificationStatusKey, status),
      ),
    [queryClient],
  );
  return useQuery({
    queryKey: notificationStatusKey,
    queryFn: () =>
      invoke<{ status: "unknown" | "delivered" | "refused" }>("system:notificationStatus"),
  });
}

export function MeetingsSettings() {
  const { settings, edit } = useSettingsEditor();
  const notifications = useNotificationStatus().data;
  if (!settings) return null;
  const meetings = settings.system.meetings;
  return (
    <FieldSet title="Meetings">
      <Field
        label="Up Next card"
        description="Your next meeting with its join link and prep, on Today and in the menu bar."
      >
        <Switch
          id="meetings-up-next"
          aria-label="Up Next card"
          checked={meetings.upNext}
          onCheckedChange={(upNext) =>
            edit((draft) => {
              draft.system.meetings.upNext = upNext;
            })
          }
        />
      </Field>
      <Field
        label="Notify before meetings"
        description="A macOS notification with a Join button."
        error={
          meetings.notify && notifications?.status === "refused"
            ? "macOS didn't deliver DayBoard's notification. Check System Settings → Notifications."
            : undefined
        }
      >
        <Switch
          id="meetings-notify"
          aria-label="Notify before meetings"
          checked={meetings.notify}
          onCheckedChange={(notify) =>
            edit((draft) => {
              draft.system.meetings.notify = notify;
            })
          }
        />
      </Field>
      {meetings.notify ? (
        <Field label="When">
          <SettingSelect
            label="When to notify"
            value={String(meetings.notifyMinutesBefore)}
            options={NOTIFY_OPTIONS}
            onChange={(value) =>
              edit((draft) => {
                draft.system.meetings.notifyMinutesBefore = Number(
                  value,
                ) as typeof draft.system.meetings.notifyMinutesBefore;
              })
            }
          />
        </Field>
      ) : null}
      <Field
        label="Meeting notes from Granola"
        description="After a meeting, offer to pull its notes from a Granola MCP server in Settings → MCP."
      >
        <Switch
          id="meetings-notes-import"
          aria-label="Meeting notes from Granola"
          checked={meetings.notesImport}
          onCheckedChange={(notesImport) =>
            edit((draft) => {
              draft.system.meetings.notesImport = notesImport;
            })
          }
        />
      </Field>
    </FieldSet>
  );
}
