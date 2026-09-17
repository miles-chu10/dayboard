import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "@glaze/core/components";
import type {
  AccountsStatus,
  CalendarEventItem,
  MailItem,
  ReminderItem,
  SourceResult,
  TaskItem,
} from "@main/shared-types";

import { errorMessage, invoke } from "./ipc";
import type { Todo } from "./todos";

export const queryKeys = {
  accounts: ["accounts"],
  tasks: ["tasks"],
  reminders: ["reminders"],
  mail: ["mail"],
  calendar: ["calendar"],
} as const;

const SOURCE_STALE_TIME = 2 * 60_000;

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => invoke<AccountsStatus>("accounts:getStatus"),
    staleTime: 30_000,
  });
}

export function useTasks() {
  return useQuery({
    queryKey: queryKeys.tasks,
    queryFn: () => invoke<SourceResult<TaskItem>>("tasks:list"),
    staleTime: SOURCE_STALE_TIME,
  });
}

export function useReminders() {
  return useQuery({
    queryKey: queryKeys.reminders,
    queryFn: () => invoke<SourceResult<ReminderItem>>("reminders:list"),
    staleTime: SOURCE_STALE_TIME,
  });
}

export function useMail() {
  return useQuery({
    queryKey: queryKeys.mail,
    queryFn: () => invoke<SourceResult<MailItem>>("mail:list"),
    staleTime: SOURCE_STALE_TIME,
  });
}

export function useCalendar() {
  return useQuery({
    queryKey: queryKeys.calendar,
    queryFn: () => invoke<SourceResult<CalendarEventItem>>("calendar:list"),
    staleTime: SOURCE_STALE_TIME,
  });
}

/** Refetch everything when account state changes in any window. */
export function useAccountsSync() {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.glazeAPI.glaze.ipc.onNotification("accounts:changed", () => {
        void queryClient.invalidateQueries();
      }),
    [queryClient],
  );
}

function setTodoCompleted(queryClient: QueryClient, todo: Todo, completed: boolean) {
  if (todo.task) {
    const id = todo.task.id;
    queryClient.setQueryData<SourceResult<TaskItem>>(queryKeys.tasks, (prev) =>
      prev?.state === "ok"
        ? { ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, completed } : item)) }
        : prev,
    );
  } else if (todo.reminder) {
    const ref = todo.reminder.ref;
    queryClient.setQueryData<SourceResult<ReminderItem>>(queryKeys.reminders, (prev) =>
      prev?.state === "ok"
        ? { ...prev, items: prev.items.map((item) => (item.ref === ref ? { ...item, completed } : item)) }
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
        await invoke("reminders:setCompleted", { ref: todo.reminder.ref, completed: !todo.completed });
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
      toast.success(status.google.email ? `Connected ${status.google.email}` : "Google account connected");
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
