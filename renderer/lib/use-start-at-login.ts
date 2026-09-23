import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@renderer/ui";

import { errorMessage, invoke } from "./ipc";

export interface StartAtLoginState {
  openAtLogin: boolean;
  status?: "not-registered" | "enabled" | "requires-approval" | "not-found";
}

const startAtLoginKey = ["startup", "login-item"] as const;

/** The OS-provided login-item setting and the mutation that changes it. */
export function useStartAtLogin() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: startAtLoginKey,
    queryFn: () => invoke<StartAtLoginState>("startup:getLoginItem"),
    staleTime: 60_000,
  });
  const setOpenAtLogin = useMutation({
    mutationFn: (openAtLogin: boolean) =>
      invoke<StartAtLoginState>("startup:setLoginItem", { openAtLogin }),
    onSuccess: (state) => queryClient.setQueryData(startAtLoginKey, state),
    onError: (error) => toast.error(`Couldn't update start at login: ${errorMessage(error)}`),
  });

  return { ...query, setOpenAtLogin };
}
