import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Button, Callout, EmptyState } from "@glaze/core/components";
import type { SourceResult } from "@main/shared-types";

import { errorMessage, invoke, openSettings } from "../lib/ipc";
import { useConnectGoogle, useRequestRemindersAccess } from "../lib/queries";
import { RowsSkeleton } from "./section-card";

type UnavailableResult = Exclude<SourceResult<unknown>, { state: "ok" }>;

export function SourceGate<T>({
  query,
  label,
  children,
}: {
  query: UseQueryResult<SourceResult<T>>;
  label: string;
  children: (items: T[]) => ReactNode;
}) {
  if (query.isPending) return <RowsSkeleton rows={6} />;
  if (query.isError) {
    return (
      <Callout
        color="red"
        role="alert"
        actions={
          <Button size="small" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      >
        {errorMessage(query.error)}
      </Callout>
    );
  }
  if (query.data.state === "ok") return <>{children(query.data.items)}</>;
  return <SourceEmptyState result={query.data} label={label} />;
}

function SourceEmptyState({ result, label }: { result: UnavailableResult; label: string }) {
  const connect = useConnectGoogle();
  const requestAccess = useRequestRemindersAccess();

  switch (result.state) {
    case "disabled":
      return (
        <EmptyState
          placement="viewport"
          title="Turned Off"
          description={`${label} is hidden from your dashboard. Turn it back on in Settings → Sources.`}
          actions={<Button onClick={() => void openSettings()}>Open Settings</Button>}
        />
      );
    case "needs-setup":
      return (
        <EmptyState
          placement="viewport"
          title="Set Up Google"
          description="Add your Google OAuth client in Settings to bring in Tasks, Gmail, and Calendar."
          actions={<Button onClick={() => void openSettings()}>Open Settings</Button>}
        />
      );
    case "not-connected":
      return (
        <EmptyState
          placement="viewport"
          title="Google Isn't Connected"
          description={`Sign in with Google to show your ${label}.`}
          actions={
            <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
              {connect.isPending ? "Waiting for Browser…" : "Connect Google"}
            </Button>
          }
        />
      );
    case "no-access":
      return result.access === "not-determined" ? (
        <EmptyState
          placement="viewport"
          title="Allow Reminders Access"
          description="Dashboard needs permission to show and update your Apple Reminders."
          actions={
            <Button onClick={() => requestAccess.mutate()} disabled={requestAccess.isPending}>
              Allow Access
            </Button>
          }
        />
      ) : (
        <EmptyState
          placement="viewport"
          title="Reminders Access Is Off"
          description="Turn on access for Dashboard in System Settings → Privacy & Security → Reminders."
          actions={<Button onClick={() => void invoke("reminders:openSettings")}>Open Privacy Settings</Button>}
        />
      );
  }
}

export function sourceHint(result: SourceResult<unknown> | undefined, label: string): string | null {
  if (!result || result.state === "ok") return null;
  if (result.state === "disabled") return `${label} is turned off in Settings.`;
  if (result.state === "no-access") return `Allow Reminders access to see ${label}.`;
  if (result.state === "needs-setup") return `Set up Google in Settings to see ${label}.`;
  return `Connect Google to see ${label}.`;
}

/** Short status for summary tiles. */
export function sourceStatusShort(result: SourceResult<unknown> | undefined): string | null {
  if (!result || result.state === "ok") return null;
  if (result.state === "no-access") return "Needs access";
  if (result.state === "needs-setup") return "Needs setup";
  if (result.state === "disabled") return "Turned off";
  return "Not connected";
}
