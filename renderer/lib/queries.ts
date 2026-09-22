import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import type {
  AccountsStatus,
  AgendaCreateBlockInput,
  AgendaDuplicateLink,
  AgendaScheduledBlock,
  AgendaState,
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
import { buildTodos, linkedKeys, type Todo } from "./todos";

export const queryKeys = {
  accounts: ["accounts"],
  settings: settingsQueryKey,
  tasks: ["tasks"],
  reminders: ["reminders"],
  mail: ["mail"],
  calendar: ["calendar"],
  calendarRange: (startDate: string, days: number) =>
    ["calendar", "range", startDate, days] as const,
  calendars: ["calendars"],
  review: ["review"],
  mcpServers: ["mcp-servers"],
  assistantMcp: ["assistant-mcp"],
  agenda: ["agenda"],
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
const todoWrites = new Set<string>();

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
    queryFn: async ({ signal }) => {
      if (!sourceOn(queryClient.getQueryData<AppSettings>(settingsQueryKey), source)) {
        return { state: "disabled" } as SourceResult<T>;
      }
      try {
        const result = await invoke<SourceResult<T>>(channel);
        if (signal.aborted) throw new DOMException("Source fetch was cancelled", "AbortError");
        return result.state === "ok"
          ? { ...result, refreshedAt: new Date().toISOString(), refreshError: undefined }
          : result;
      } catch (error) {
        if (signal.aborted) throw error;
        const previous = queryClient.getQueryData<SourceResult<T>>(key);
        if (previous?.state === "ok") {
          return {
            ...previous,
            refreshError: errorMessage(error).slice(0, 240),
          };
        }
        throw error;
      }
    },
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

/** A bounded date range for Calendar navigation, independent of the Settings default. */
export function useCalendarRange(startDate: string, days: number) {
  const settings = useSettings();
  const queryClient = useQueryClient();
  const key = queryKeys.calendarRange(startDate, days);
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      if (!sourceOn(queryClient.getQueryData<AppSettings>(settingsQueryKey), "calendar"))
        return { state: "disabled" } as SourceResult<CalendarEventItem>;
      try {
        const result = await invoke<SourceResult<CalendarEventItem>>("calendar:listRange", {
          startDate,
          days,
        });
        if (signal.aborted)
          throw new DOMException("Calendar range fetch was cancelled", "AbortError");
        return result.state === "ok"
          ? { ...result, refreshedAt: new Date().toISOString(), refreshError: undefined }
          : result;
      } catch (error) {
        if (signal.aborted) throw error;
        const previous = queryClient.getQueryData<SourceResult<CalendarEventItem>>(key);
        if (previous?.state === "ok")
          return { ...previous, refreshError: errorMessage(error).slice(0, 240) };
        throw error;
      }
    },
    enabled: settings.isSuccess,
    staleTime: SOURCE_STALE_TIME,
    refetchInterval: settings.data?.general.refreshMinutes
      ? settings.data.general.refreshMinutes * 60_000
      : false,
  });
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

export function useAssistantMcpStatus() {
  return useQuery({
    queryKey: queryKeys.assistantMcp,
    queryFn: () =>
      invoke<{ serverCount: number; state: "unavailable" | "checking" | "ready" | "error" }>(
        "mcp:assistantStatus",
      ),
    staleTime: 30_000,
  });
}

/** Keeps every window in step with account, settings, and MCP changes made anywhere. */
export function useBackendSync() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const ipc = window.glazeAPI.glaze.ipc;
    const unsubscribers = [
      ipc.onNotification("accounts:changed", () => {
        // Never show a prior account's cached data during a reconnect or switch.
        for (const queryKey of [...DATA_KEYS, queryKeys.agenda])
          void queryClient.resetQueries({ queryKey });
        void queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      }),
      ipc.onNotification("settings:changed", (params) => {
        const event = params as Partial<SettingsChangedEvent> | null;
        if (event?.settings) queryClient.setQueryData(settingsQueryKey, event.settings);
        void queryClient.invalidateQueries({ queryKey: queryKeys.assistantMcp });
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
        void queryClient.invalidateQueries({ queryKey: queryKeys.assistantMcp });
      }),
      ipc.onNotification("agenda:changed", (params) => {
        const state = params as AgendaState | null;
        if (state) queryClient.setQueryData(queryKeys.agenda, state);
        else void queryClient.invalidateQueries({ queryKey: queryKeys.agenda });
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [queryClient]);
}

function todoQueryKey(todo: Todo) {
  return todo.task ? queryKeys.tasks : queryKeys.reminders;
}

function setTodoCompleted(
  queryClient: QueryClient,
  todo: Todo,
  completed: boolean,
  onlyIf?: boolean,
) {
  if (todo.task) {
    const id = todo.task.id;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (prev) =>
      prev?.state === "ok"
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.id === id &&
              item.listId === todo.task!.listId &&
              (onlyIf === undefined || item.completed === onlyIf)
                ? { ...item, completed }
                : item,
            ),
          }
        : prev,
    );
  } else if (todo.reminder) {
    const ref = todo.reminder.ref;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (prev) =>
      prev?.state === "ok"
        ? {
            ...prev,
            items: prev.items.map((item) =>
              item.ref === ref && (onlyIf === undefined || item.completed === onlyIf)
                ? { ...item, completed }
                : item,
            ),
          }
        : prev,
    );
  }
}

async function writeCompleted(todo: Todo, completed: boolean): Promise<void> {
  if (todo.task) {
    await invoke("tasks:setCompleted", {
      listId: todo.task.listId,
      taskId: todo.task.id,
      completed,
    });
  } else if (todo.reminder) {
    await invoke("reminders:setCompleted", { ref: todo.reminder.ref, completed });
  }
}

/** Linked items still in the same state as `todo`, so they flip together. */
function linkedPartners(queryClient: QueryClient, todo: Todo): Todo[] {
  const keys = linkedKeys(
    queryClient.getQueryData<AgendaState>(queryKeys.agenda)?.duplicateLinks,
    todo.key,
  );
  if (!keys.length) return [];
  return buildTodos(
    queryClient.getQueryData<SourceResult<TaskItem>>(queryKeys.tasks),
    queryClient.getQueryData<SourceResult<ReminderItem>>(queryKeys.reminders),
  ).filter(
    (other) =>
      keys.includes(other.key) && other.completed === todo.completed && !todoWrites.has(other.key),
  );
}

export function useToggleTodo() {
  const queryClient = useQueryClient();
  const revisions = useRef(new Map<string, number>());
  const partnersFor = useRef(new Map<string, Todo[]>());
  const mutation = useMutation({
    mutationFn: async (todo: Todo) => {
      const completed = !todo.completed;
      await writeCompleted(todo, completed);
      const partners = partnersFor.current.get(todo.key) ?? [];
      const results = await Promise.allSettled(
        partners.map((partner) => writeCompleted(partner, completed)),
      );
      return partners.filter((_partner, index) => results[index].status === "rejected");
    },
    onMutate: async (todo) => {
      if (todoWrites.has(todo.key)) throw new Error("This item is already being updated.");
      const partners = linkedPartners(queryClient, todo);
      partnersFor.current.set(todo.key, partners);
      todoWrites.add(todo.key);
      for (const partner of partners) todoWrites.add(partner.key);
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders });
      const revision = (revisions.current.get(todo.key) ?? 0) + 1;
      revisions.current.set(todo.key, revision);
      const targetCompleted = !todo.completed;
      for (const item of [todo, ...partners]) setTodoCompleted(queryClient, item, targetCompleted);
      return { revision, targetCompleted, partners };
    },
    onError: (error, todo, context) => {
      if (context && revisions.current.get(todo.key) === context.revision) {
        setTodoCompleted(queryClient, todo, todo.completed, context.targetCompleted);
        for (const partner of context.partners)
          setTodoCompleted(queryClient, partner, partner.completed, context.targetCompleted);
        toast.error(`Couldn't update “${todo.title}”: ${errorMessage(error)}`);
      }
    },
    onSuccess: (failedPartners, todo, context) => {
      if (failedPartners.length)
        toast.error(
          `“${todo.title}” updated, but its linked item in ${failedPartners
            .map((partner) => (partner.source === "tasks" ? "Google Tasks" : "Apple Reminders"))
            .join(" and ")} couldn't be updated.`,
        );
      const plan = queryClient.getQueryData<AgendaState>(queryKeys.agenda);
      if (!todo.completed && plan?.focusKeys.includes(todo.key)) {
        void invoke<AgendaState>("agenda:setFocus", {
          focusKeys: plan.focusKeys.filter((key) => key !== todo.key),
        })
          .then((state) => queryClient.setQueryData(queryKeys.agenda, state))
          .catch(() => toast.error("The item completed, but its focus pin could not be removed."));
      }
      const synced = (context?.partners.length ?? 0) - failedPartners.length;
      toast.success(
        `Updated “${todo.title}”${synced ? ` and ${synced} linked item${synced === 1 ? "" : "s"}` : ""}`,
        {
          action: {
            label: "Undo",
            onClick: () => mutation.mutate({ ...todo, completed: !todo.completed }),
          },
        },
      );
    },
    onSettled: (_result, _error, todo, context) => {
      if (!context) return;
      todoWrites.delete(todo.key);
      for (const partner of context.partners) todoWrites.delete(partner.key);
      partnersFor.current.delete(todo.key);
      if (context && revisions.current.get(todo.key) === context.revision)
        revisions.current.delete(todo.key);
      void queryClient.invalidateQueries({ queryKey: todoQueryKey(todo) });
      for (const partner of context.partners)
        void queryClient.invalidateQueries({ queryKey: todoQueryKey(partner) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.review });
    },
  });
  return mutation;
}

export function useAgendaState() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.agenda,
    queryFn: () => invoke<AgendaState>("agenda:getState"),
    staleTime: 5 * 60_000,
  });
  const setFocus = useMutation({
    mutationFn: (input: { focusKeys: string[] }) => invoke<AgendaState>("agenda:setFocus", input),
    onSuccess: (state) => queryClient.setQueryData(queryKeys.agenda, state),
    onError: (error) => toast.error(`Couldn't save focus: ${errorMessage(error)}`),
  });
  const setDuplicateLink = useMutation({
    mutationFn: (input: AgendaDuplicateLink) =>
      invoke<AgendaState>("agenda:setDuplicateLink", input),
    onSuccess: (state) => queryClient.setQueryData(queryKeys.agenda, state),
    onError: (error) => toast.error(`Couldn't save item link: ${errorMessage(error)}`),
  });
  const removeDuplicateLink = useMutation({
    mutationFn: (input: Pick<AgendaDuplicateLink, "leftKey" | "rightKey">) =>
      invoke<AgendaState>("agenda:removeDuplicateLink", input),
    onSuccess: (state) => queryClient.setQueryData(queryKeys.agenda, state),
    onError: (error) => toast.error(`Couldn't unlink items: ${errorMessage(error)}`),
  });
  const removeScheduledBlock = useMutation({
    mutationFn: (input: Pick<AgendaScheduledBlock, "taskKey" | "eventId">) =>
      invoke<AgendaState>("agenda:removeScheduledBlock", input),
    onSuccess: (state) => queryClient.setQueryData(queryKeys.agenda, state),
    onError: (error) => toast.error(`Couldn't unlink calendar block: ${errorMessage(error)}`),
  });
  const createBlock = useMutation({
    mutationFn: (input: AgendaCreateBlockInput) =>
      invoke<AgendaScheduledBlock>("agenda:createBlock", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agenda });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.review });
    },
  });
  return {
    ...query,
    isPending:
      query.isPending ||
      setFocus.isPending ||
      setDuplicateLink.isPending ||
      removeDuplicateLink.isPending ||
      removeScheduledBlock.isPending ||
      createBlock.isPending,
    setFocus,
    setDuplicateLink,
    removeDuplicateLink,
    removeScheduledBlock,
    createBlock,
  };
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
