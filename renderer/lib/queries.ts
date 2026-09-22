import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import type {
  AccountsStatus,
  AgendaCreateBlockInput,
  AgendaDuplicateLink,
  AgendaScheduledBlock,
  AgendaScopedState,
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
  agendaScope: ["agenda", "scope"],
  agendaForScope: (scope: string) => ["agenda", "state", scope] as const,
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
const todoVersions = new Map<string, number>();

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
        for (const queryKey of [...DATA_KEYS, queryKeys.agendaScope])
          void queryClient.resetQueries({ queryKey });
        void queryClient.cancelQueries({ queryKey: ["agenda", "state"] });
        queryClient.removeQueries({ queryKey: ["agenda", "state"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
      }),
      ipc.onNotification("settings:changed", (params) => {
        const event = params as Partial<SettingsChangedEvent> | null;
        if (event?.settings) queryClient.setQueryData(settingsQueryKey, event.settings);
        void queryClient.invalidateQueries({ queryKey: queryKeys.assistantMcp });
        void queryClient.invalidateQueries({ queryKey: ["assistant-mcp-servers"] });
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
        void queryClient.invalidateQueries({ queryKey: ["assistant-mcp-servers"] });
        void queryClient.invalidateQueries({ queryKey: ["assistant-mcp-check"] });
        void queryClient.invalidateQueries({ queryKey: queryKeys.mcpServers });
        void queryClient.invalidateQueries({ queryKey: queryKeys.assistantMcp });
      }),
      ipc.onNotification("agenda:changed", (params) => {
        const event = params as AgendaScopedState | null;
        if (event?.scope && event.state) {
          void queryClient.cancelQueries(
            { queryKey: queryKeys.agendaForScope(event.scope) },
            { revert: false },
          );
          queryClient.setQueryData(queryKeys.agendaForScope(event.scope), event.state);
        } else void queryClient.invalidateQueries({ queryKey: ["agenda", "state"] });
      }),
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [queryClient]);
}

function todoQueryKey(todo: Todo) {
  return todo.task ? queryKeys.tasks : queryKeys.reminders;
}

function currentAgendaState(queryClient: QueryClient): AgendaState | undefined {
  const scope = queryClient.getQueryData<string>(queryKeys.agendaScope);
  return scope ? queryClient.getQueryData<AgendaState>(queryKeys.agendaForScope(scope)) : undefined;
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

function setTodoCanonical(queryClient: QueryClient, todo: Todo, canonical: ReminderItem | null) {
  if (!todo.reminder || !canonical) return;
  const previousRef = todo.reminder.ref;
  queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (prev) =>
    prev?.state === "ok"
      ? {
          ...prev,
          items: prev.items.map((item) => (item.ref === previousRef ? canonical : item)),
        }
      : prev,
  );
}

async function writeCompleted(
  todo: Todo,
  completed: boolean,
  expectedScope: string,
): Promise<ReminderItem | null> {
  if (todo.task) {
    await invoke("tasks:setCompleted", {
      listId: todo.task.listId,
      taskId: todo.task.id,
      completed,
      expectedScope,
    });
    return null;
  } else if (todo.reminder) {
    return invoke<ReminderItem>("reminders:setCompleted", {
      ref: todo.reminder.ref,
      completed,
      expectedScope,
    });
  }
  throw new Error("This item is unavailable in its source.");
}

/** Linked items still in the same state as `todo`, so they flip together. */
function linkedPartners(queryClient: QueryClient, todo: Todo): Todo[] {
  const keys = linkedKeys(currentAgendaState(queryClient)?.duplicateLinks, todo.key);
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
  const partnersFor = useRef(new Map<string, { partners: Todo[]; scope: string }>());
  const undoExact = async (participants: Todo[], scope: string, versions: Map<string, number>) => {
    if (queryClient.getQueryData<string>(queryKeys.agendaScope) !== scope) {
      toast.error("Return to the original account before using Undo.");
      return false;
    }
    if (
      participants.some(
        (item) =>
          todoWrites.has(item.key) ||
          todoVersions.get(`${scope}:${item.key}`) !== versions.get(item.key),
      )
    ) {
      toast.error(
        "These items have changed since this update. Refresh to see their current state.",
      );
      return false;
    }
    for (const item of participants) todoWrites.add(item.key);
    const results = await Promise.allSettled(
      participants.map((participant) => writeCompleted(participant, participant.completed, scope)),
    );
    for (const item of participants) todoWrites.delete(item.key);
    if (queryClient.getQueryData<string>(queryKeys.agendaScope) !== scope) return true;
    const failed = participants.filter(
      (_participant, index) => results[index].status === "rejected",
    );
    for (const [index, result] of results.entries()) {
      if (result.status !== "fulfilled") continue;
      const participant = participants[index];
      setTodoCanonical(queryClient, participant, result.value);
      const canonicalParticipant = result.value
        ? { ...participant, reminder: result.value }
        : participant;
      if (!result.value) setTodoCompleted(queryClient, canonicalParticipant, participant.completed);
      if (result.value?.agendaSaveError) toast.error(result.value.agendaSaveError);
    }
    for (const participant of participants)
      void queryClient.invalidateQueries({ queryKey: todoQueryKey(participant) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.review });
    if (failed.length) {
      toast.error("Some linked items could not be restored. Refresh to see their current state.");
    }
    return true;
  };
  const mutation = useMutation({
    mutationFn: async (todo: Todo) => {
      const completed = !todo.completed;
      const operation = partnersFor.current.get(todo.key);
      if (!operation) throw new Error("This update could not be started. Try again.");
      const { partners, scope } = operation;
      const primary = await writeCompleted(todo, completed, scope);
      const results = await Promise.allSettled(
        partners.map((partner) => writeCompleted(partner, completed, scope)),
      );
      return {
        failed: partners.filter((_partner, index) => results[index].status === "rejected"),
        successful: [
          { participant: todo, canonical: primary },
          ...partners.flatMap((partner, index) => {
            const result = results[index];
            return result.status === "fulfilled"
              ? [{ participant: partner, canonical: result.value }]
              : [];
          }),
        ],
      };
    },
    onMutate: async (todo) => {
      if (todoWrites.has(todo.key)) throw new Error("This item is already being updated.");
      const scope = queryClient.getQueryData<string>(queryKeys.agendaScope);
      if (!scope || scope === "unavailable")
        throw new Error("Your account is still loading. Try again shortly.");
      const partners = linkedPartners(queryClient, todo);
      partnersFor.current.set(todo.key, { partners, scope });
      todoWrites.add(todo.key);
      for (const partner of partners) todoWrites.add(partner.key);
      await queryClient.cancelQueries({ queryKey: queryKeys.tasks });
      await queryClient.cancelQueries({ queryKey: queryKeys.reminders });
      if (queryClient.getQueryData<string>(queryKeys.agendaScope) !== scope) {
        for (const item of [todo, ...partners]) todoWrites.delete(item.key);
        partnersFor.current.delete(todo.key);
        throw new Error("The account changed before this update started.");
      }
      const revision = (revisions.current.get(todo.key) ?? 0) + 1;
      revisions.current.set(todo.key, revision);
      const targetCompleted = !todo.completed;
      const versions = new Map<string, number>();
      for (const item of [todo, ...partners]) {
        const version = (todoVersions.get(`${scope}:${item.key}`) ?? 0) + 1;
        todoVersions.set(`${scope}:${item.key}`, version);
        versions.set(item.key, version);
        setTodoCompleted(queryClient, item, targetCompleted);
      }
      return { revision, targetCompleted, partners, scope, versions };
    },
    onError: (error, todo, context) => {
      if (
        context &&
        queryClient.getQueryData<string>(queryKeys.agendaScope) === context.scope &&
        revisions.current.get(todo.key) === context.revision
      ) {
        setTodoCompleted(queryClient, todo, todo.completed, context.targetCompleted);
        for (const partner of context.partners)
          setTodoCompleted(queryClient, partner, partner.completed, context.targetCompleted);
      }
      toast.error(`Couldn't update “${todo.title}”: ${errorMessage(error)}`);
    },
    onSuccess: (result, todo, context) => {
      if (!context || queryClient.getQueryData<string>(queryKeys.agendaScope) !== context.scope)
        return;
      const failedPartners = result.failed;
      const successfulParticipants = result.successful.map(({ participant, canonical }) => {
        setTodoCanonical(queryClient, participant, canonical);
        if (canonical?.agendaSaveError) toast.error(canonical.agendaSaveError);
        // Keep the original completed value for Undo while replacing only its
        // opaque transport ref with the canonical mutation result.
        return canonical ? { ...participant, reminder: canonical } : participant;
      });
      // A failed partner's optimistic value must not remain checked when a
      // subsequent refetch also fails; restore from the captured original.
      for (const partner of failedPartners)
        setTodoCompleted(queryClient, partner, partner.completed, context?.targetCompleted);
      if (failedPartners.length)
        toast.error(
          `“${todo.title}” updated, but its linked item in ${failedPartners
            .map((partner) => (partner.source === "tasks" ? "Google Tasks" : "Apple Reminders"))
            .join(" and ")} couldn't be updated.`,
        );
      const plan = currentAgendaState(queryClient);
      const completedKeys = new Set(
        result.successful
          .filter(
            ({ participant, canonical }) =>
              !participant.completed && (!canonical || canonical.completed),
          )
          .map(({ participant }) => participant.key),
      );
      if (plan?.focusKeys.some((key) => completedKeys.has(key))) {
        void invoke<AgendaScopedState>("agenda:setFocus", {
          focusKeys: plan.focusKeys.filter((key) => !completedKeys.has(key)),
          expectedScope: context.scope,
        })
          .then((result) =>
            queryClient.setQueryData(queryKeys.agendaForScope(result.scope), result.state),
          )
          .catch(() => toast.error("The item completed, but its focus pin could not be removed."));
      }
      const synced = (context?.partners.length ?? 0) - failedPartners.length;
      const undoUnsupported = successfulParticipants.some(
        (participant) => participant.reminder?.recurring && !participant.completed,
      );
      let undoUsed = false;
      toast.success(
        `Updated “${todo.title}”${synced ? ` and ${synced} linked item${synced === 1 ? "" : "s"}` : ""}`,
        undoUnsupported
          ? {
              description:
                "Undo is unavailable because a recurring reminder advanced to its next occurrence.",
            }
          : {
              action: {
                label: "Undo",
                // This exact success snapshot never recomputes current graph partners.
                onClick: async () => {
                  if (undoUsed) return;
                  undoUsed = true;
                  if (!(await undoExact(successfulParticipants, context.scope, context.versions)))
                    undoUsed = false;
                },
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
  const scopeQuery = useQuery({
    queryKey: queryKeys.agendaScope,
    queryFn: () => invoke<string>("agenda:getScope"),
    staleTime: 30_000,
  });
  const scope = scopeQuery.data;
  const query = useQuery({
    queryKey: queryKeys.agendaForScope(scope ?? "pending"),
    queryFn: async ({ signal }) => {
      const result = await invoke<AgendaScopedState>("agenda:getState");
      if (signal.aborted || result.scope !== scope)
        throw new DOMException("Agenda account changed while state was loading.", "AbortError");
      return result.state;
    },
    enabled: Boolean(scope) && scope !== "unavailable",
    staleTime: 5 * 60_000,
  });
  const storeResult = (result: AgendaScopedState) =>
    queryClient.setQueryData(queryKeys.agendaForScope(result.scope), result.state);
  const setFocus = useMutation({
    mutationFn: (input: { focusKeys: string[] }) =>
      invoke<AgendaScopedState>("agenda:setFocus", { ...input, expectedScope: scope }),
    onSuccess: storeResult,
    onError: (error) => toast.error(`Couldn't save focus: ${errorMessage(error)}`),
  });
  const setDuplicateLink = useMutation({
    mutationFn: (input: AgendaDuplicateLink) =>
      invoke<AgendaScopedState>("agenda:setDuplicateLink", { ...input, expectedScope: scope }),
    onSuccess: storeResult,
    onError: (error) => toast.error(`Couldn't save item link: ${errorMessage(error)}`),
  });
  const removeDuplicateLink = useMutation({
    mutationFn: (input: Pick<AgendaDuplicateLink, "leftKey" | "rightKey">) =>
      invoke<AgendaScopedState>("agenda:removeDuplicateLink", { ...input, expectedScope: scope }),
    onSuccess: storeResult,
    onError: (error) => toast.error(`Couldn't unlink items: ${errorMessage(error)}`),
  });
  const removeScheduledBlock = useMutation({
    mutationFn: (input: Pick<AgendaScheduledBlock, "taskKey" | "eventId">) =>
      invoke<AgendaScopedState>("agenda:removeScheduledBlock", { ...input, expectedScope: scope }),
    onSuccess: storeResult,
    onError: (error) => toast.error(`Couldn't unlink calendar block: ${errorMessage(error)}`),
  });
  const createBlock = useMutation({
    mutationFn: (input: AgendaCreateBlockInput) =>
      invoke<AgendaScheduledBlock>("agenda:createBlock", { ...input, expectedScope: scope }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.agendaForScope(scope ?? "pending"),
      });
      void queryClient.invalidateQueries({ queryKey: queryKeys.calendar });
      void queryClient.invalidateQueries({ queryKey: queryKeys.review });
    },
  });
  return {
    ...query,
    isError: scopeQuery.isError || query.isError,
    error: scopeQuery.error ?? query.error,
    isPending:
      scopeQuery.isPending ||
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
        status.google.email ? `Signed in as ${status.google.email}` : "Signed in with Google",
      );
    },
    onError: (error) => toast.error(`Couldn't sign in with Google: ${errorMessage(error)}`),
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
