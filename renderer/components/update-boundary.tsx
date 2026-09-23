import type { ReactNode } from "react";
import { useAppUpdates } from "../lib/app-updates";
import { Dialog, Status } from "../ui";

/** Freeze both windows while main rejects new work and drains operations already in progress. */
export function UpdateBoundary({ children }: { children: ReactNode }) {
  const { data } = useAppUpdates();
  const preparing = data?.phase === "preparing";
  const locked = preparing || data?.phase === "installing";
  return (
    <>
      <div className="h-full" inert={locked}>
        {children}
      </div>
      <Dialog
        open={locked}
        title={preparing ? "Preparing update" : "Installing update"}
        description={
          preparing
            ? "Finishing pending work before restarting DayBoard."
            : "DayBoard will reopen when the update is ready."
        }
      >
        <Status variant="loading">{data?.message}</Status>
      </Dialog>
    </>
  );
}
