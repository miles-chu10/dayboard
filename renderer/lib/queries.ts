import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import type {
  AccountsStatus,
  AppSettings,
  CalendarEventItem,
  CalendarListResult,
  DataChangedEvent,
  MailItem,
  McpServerConfig,
  ReminderItem,
  ReviewData,
  SettingsChangedEvent,
  SourceId,
  SourceResult,
  TaskItem,
} from "@main/shared-types";

import { errorMessage, invoke } from "./ipc";
import { settingsQueryKey, sourceOn, useSettings } from "./settings";
import type { Todo } from "./todos";

export const queryKeys = {
  accounts: ["accounts"],
  settings: settingsQueryKey,
  tasks: ["tasks"],
  reminders: ["reminders"],
  mail: ["mail"],
  calendar: ["calendar"],
  calendars: ["calendars"],
  review: ["review"],
  mcpServers: ["mcp-servers"],
} as const;

const DATA_KEYS = [
  queryKeys.tasks,
  queryKeys.reminders,
  queryKeys.mail,
  queryKeys.calendar,
  queryKeys.calendars,
  queryKeys.review,
];

const SOURCE_STALE_TIME = 2 * 60_000;

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => invoke<AccountsStatus>("accounts:getStatus"),
    staleTime: 30_000,
  });
}

function useSourceQuery<T>(key: readonly string[], channel: string, source: SourceId) {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const refreshMinutes = settings.data?.general.refreshMinutes ?? 0;
  return useQuery({
    queryKey: key,
    // Read settings at fetch time so an invalidation right after a settings change uses the new value.
    queryFn: () =>
      sourceOn(queryClient.getQueryData<AppSettings>(settingsQueryKey), source)
        ? invoke<SourceResult<T>>(channel)
        : Promise.resolve<SourceResult<T>>({ state: "disabled" }),
    enabled: settings.isSuccess,
    staleTime: SOURCE_STALE_TIME,
    refetchInterval: refreshMinutes > 0 ? refreshMinutes * 60_000 : false,
  });
}

export function useTasks() {
  return useSourceQuery<TaskItem>(queryKeys.tasks, "tasks:list", "tasks");
}

export function useReminders() {
  return useSourceQuery<ReminderItem>(queryKeys.reminders, "reminders:list", "reminders");
}

export function useMail() {
  return useSourceQuery<MailItem>(queryKeys.mail, "mail:list", "mail");
}

export function useCalendar() {
  return useSourceQuery<CalendarEventItem>(queryKeys.calendar, "calendar:list", "calendar");
}

export function useCalendars(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.calendars,
    queryFn: () => invoke<CalendarListResult>("calendar:listCalendars"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useReview() {
  return useQuery({
    queryKey: queryKeys.review,
    queryFn: () => invoke<ReviewData>("review:data"),
    staleTime: 5 * 60_000,
  });
}

export function useMcpServers() {
  return useQuery({
    queryKey: queryKeys.mcpServers,
    queryFn: () => invoke<McpServerConfig[]>("mcp:list"),
  });
}

/** Keeps every window in step with account, settings, and MCP changes made anywhere. */
export function useBackendSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const ipc = window.glazeAPI.glaze.ipc;
    const unsubscribers = [
      ipc.onNotification("accounts:changed", () => {
        void queryClient.invalidateQueries();
      }),
      ipc.onNotification("settings:changed", (params) => {
        const event = params as Partial<SettingsChangedEvent> | null;
        if (event?.settings) queryClient.setQueryData(settingsQueryKey, event.settings);
        if (event?.dataChanged) {
          for (const key of DATA_KEYS) void queryClient.invalidateQueries({ queryKey: key });
        }
      }),
      ipc.onNotification("data:changed", (params) => {
        const event = params as Partial<DataChangedEvent> | null;
        if (event?.source)
          void queryClient.invalidateQueries({ queryKey: queryKeys[event.source] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.review });
      }),
      ipc.onNotification("mcp:changed", () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers });
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [queryClient]);
}

function setTodoCompleted(queryClient: QueryClient, todo: Todo, completed: boolean) {
  if (todo.task) {
    const id = todo.task.id;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (prev) =>
      prev?.state === "ok"
        ? {
            ...prev,
            items: prev.items.map((item) => (item.id === id ? { ...item, completed } : item)),
          }
        : prev,
    );
  } else if (todo.reminder) {
    const ref = todo.reminder.ref;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (prev) =>
      prev?.state === "ok"
        ? {
            ...prev,
            items: prev.items.map((item) => (item.ref === ref ? { ...item, completed } : item)),
          }
        : prev,
    );
  }
}

export function useToggleTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (todo: Todo) => {
      if (todo.task) {
        await invoke("tasks:setCompleted", {
          listId: todo.task.listId,
          taskId: todo.task.id,
          completed: !todo.completed,
        });
      } else if (todo.reminder) {
        await invoke("reminders:setCompleted", {
          ref: todo.reminder.ref,
          completed: !todo.completed,
        });
      }
    },
    onMutate: (todo) => setTodoCompleted(queryClient, todo, !todo.completed),
    onError: (error, todo) => {
      setTodoCompleted(queryClient, todo, todo.completed);
      toast.error(`Couldn't update “${todo.title}”: ${errorMessage(error)}`);
    },
  });
}

export function useConnectGoogle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<AccountsStatus>("google:connect"),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.accounts, status);
      void queryClient.invalidateQueries();
      toast.success(
        status.google.email ? `Connected ${status.google.email}` : "Google account connected",
      );
    },
    onError: (error) => toast.error(`Couldn't connect Google: ${errorMessage(error)}`),
  });
}

export function useRequestRemindersAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => invoke<AccountsStatus>("reminders:requestAccess"),
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.accounts, status);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reminders });
      if (status.reminders !== "full-access") {
        toast.error("Reminders access wasn't granted. You can turn it on in System Settings.");
      }
    },
    onError: (error) => toast.error(`Couldn't request Reminders access: ${errorMessage(error)}`),
  });
}
