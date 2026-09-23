import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppUpdateState } from "@shared/app-updates";
import { invoke } from "./ipc";

export const appUpdatesQueryKey = ["app-updates"] as const;

export function useAppUpdates() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: appUpdatesQueryKey,
    queryFn: () => invoke<AppUpdateState>("updates:status"),
    staleTime: Infinity,
  });
  useEffect(
    () =>
      window.dayboard.ipc.onNotification("updates:changed", (state) => {
        client.setQueryData(appUpdatesQueryKey, state as AppUpdateState);
      }),
    [client],
  );
  return query;
}
