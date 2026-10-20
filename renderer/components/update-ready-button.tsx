import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import type { AppUpdateState } from "@shared/app-updates";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@renderer/ui";

import { appUpdatesQueryKey, useAppUpdates } from "../lib/app-updates";
import { invoke } from "../lib/ipc";

/** Appears once a verified update has downloaded in the background. */
export function UpdateReadyButton() {
  const client = useQueryClient();
  const state = useAppUpdates().data;
  const install = useMutation({
    mutationFn: () => invoke<AppUpdateState>("updates:install"),
    onSuccess: (next) => client.setQueryData(appUpdatesQueryKey, next),
  });
  if (!state || !["downloaded", "preparing", "installing"].includes(state.phase)) return null;
  const busy = install.isPending || state.phase !== "downloaded";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="accent"
          size="small"
          className="mr-2"
          disabled={busy}
          onClick={() => install.mutate()}
        >
          <RotateCw />
          {busy ? "Updating…" : "Restart to update"}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{state.message}</TooltipContent>
    </Tooltip>
  );
}
