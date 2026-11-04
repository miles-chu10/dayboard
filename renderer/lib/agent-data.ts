import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "@renderer/ui";
import type { AgentActivityEntry, AgentMemory, Note, UsageDay } from "@main/shared-types";

import { errorMessage, invoke } from "./ipc";

export const agentKeys = {
  activity: ["agent-activity"],
  memories: ["agent-memories"],
  usage: ["ai-usage"],
  notes: ["notes"],
} as const;

/** A query that refetches whenever main broadcasts that its store changed. */
function useStore<T>(key: readonly string[], channel: string, changed: string) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      window.dayboard.ipc.onNotification(changed, () => {
        void queryClient.invalidateQueries({ queryKey: key });
      }),
    [queryClient, key, changed],
  );
  return useQuery({ queryKey: key, queryFn: () => invoke<T>(channel) });
}

export function useActivity() {
  return useStore<AgentActivityEntry[]>(
    agentKeys.activity,
    "agent:activity",
    "agent:activityChanged",
  );
}

export function useMemories() {
  return useStore<AgentMemory[]>(agentKeys.memories, "memory:list", "memory:changed");
}

export function useUsage() {
  return useStore<UsageDay[]>(agentKeys.usage, "usage:days", "usage:changed");
}

export function useNotes() {
  return useStore<Note[]>(agentKeys.notes, "notes:list", "notes:changed");
}

export function useMemoryActions() {
  const queryClient = useQueryClient();
  const set = (memories: AgentMemory[]) => queryClient.setQueryData(agentKeys.memories, memories);
  const add = useMutation({
    mutationFn: (text: string) => invoke<AgentMemory[]>("memory:add", { text }),
    onSuccess: set,
    onError: (error) => toast.error(`Couldn't save that: ${errorMessage(error)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => invoke<AgentMemory[]>("memory:delete", { id }),
    onSuccess: set,
    onError: (error) => toast.error(`Couldn't forget that: ${errorMessage(error)}`),
  });
  return { add, remove };
}

/** After a reply goes out, asks main whether the edits to the AI draft teach a lasting preference. */
export function learnFromDraft(draft: string, sent: string): void {
  if (!draft.trim() || !sent.trim() || draft.trim() === sent.trim()) return;
  void invoke<{ learned: string | null }>("memory:learn", { draft, sent }).then(
    ({ learned }) => {
      if (learned) toast.success(`DayBoard will remember: ${learned}`);
    },
    () => undefined,
  );
}

export function useNoteActions() {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: agentKeys.notes });
  const save = useMutation({
    mutationFn: (note: { id?: string; title: string; body: string }) =>
      invoke<Note>("notes:save", note),
    onSuccess: refresh,
    onError: (error) => toast.error(`Couldn't save the note: ${errorMessage(error)}`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => invoke("notes:delete", { id }),
    onSuccess: refresh,
    onError: (error) => toast.error(`Couldn't delete the note: ${errorMessage(error)}`),
  });
  return { save, remove };
}
