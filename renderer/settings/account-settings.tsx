import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Field, FieldSet, Status, toast } from "@renderer/ui";
import type { AccountsStatus, GoogleAccountStatus, RemindersAccess } from "@main/shared-types";

import { errorMessage, invoke } from "../lib/ipc";
import { queryKeys, useConnectGoogle, useRequestRemindersAccess } from "../lib/queries";

export function GoogleSettings({ status }: { status: GoogleAccountStatus | undefined }) {
  const queryClient = useQueryClient();
  const connect = useConnectGoogle();

  const onAccountsChanged = (next: AccountsStatus) =>
    queryClient.setQueryData(queryKeys.accounts, next);

  const disconnect = useMutation({
    mutationFn: () => invoke<AccountsStatus>("google:disconnect"),
    onSuccess: (next) => {
      onAccountsChanged(next);
      toast.success("Google account disconnected");
    },
    onError: (error) => toast.error(`Couldn't disconnect: ${errorMessage(error)}`),
  });

  if (!status) {
    return (
      <FieldSet title="Google Account">
        <Field label="Status">
          <Status variant="loading">Checking…</Status>
        </Field>
      </FieldSet>
    );
  }

  if (status.connected) {
    return (
      <FieldSet
        title="Google Account"
        description="Signs in with Google in your browser for Tasks, Gmail, and Calendar."
      >
        <Field label="Account" description={status.email ?? "Signed in"}>
          <Status variant="success">Connected</Status>
        </Field>
        <Field>
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending ? "Waiting for Browser…" : "Sign in again"}
          </Button>
          <Button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            Sign out
          </Button>
        </Field>
      </FieldSet>
    );
  }

  return (
    <FieldSet
      title="Google Account"
      description="Connect your Google account in the browser to use Tasks, Gmail, and Calendar."
    >
      <Field
        label="Account"
        description={
          status.hasCredentials
            ? "You'll finish signing in with Google in your browser."
            : "Google sign-in isn't available in this build yet."
        }
      >
        <Status variant="neutral">Not signed in</Status>
      </Field>
      <Field>
        <Button
          variant="accent"
          onClick={() => connect.mutate()}
          disabled={connect.isPending || !status.hasCredentials}
        >
          {connect.isPending ? "Waiting for Browser…" : "Sign in with Google"}
        </Button>
      </Field>
    </FieldSet>
  );
}

export function RemindersSettings({ access }: { access: RemindersAccess | undefined }) {
  const request = useRequestRemindersAccess();

  const status =
    access === undefined
      ? {
          variant: "loading" as const,
          label: "Checking…",
          description: "Show and complete your Apple Reminders.",
        }
      : access === "full-access"
        ? {
            variant: "success" as const,
            label: "Allowed",
            description: "Your reminders appear on the dashboard.",
          }
        : access === "not-determined"
          ? {
              variant: "neutral" as const,
              label: "Not allowed",
              description: "Show and complete your Apple Reminders.",
            }
          : {
              variant: "warning" as const,
              label: "Off",
              description: "Turn on access in System Settings → Privacy & Security → Reminders.",
            };

  return (
    <FieldSet title="Apple Reminders">
      <Field label="Access" description={status.description}>
        <Status variant={status.variant}>{status.label}</Status>
      </Field>
      {access === "not-determined" ? (
        <Field>
          <Button onClick={() => request.mutate()} disabled={request.isPending}>
            Allow Access
          </Button>
        </Field>
      ) : access && access !== "full-access" ? (
        <Field>
          <Button onClick={() => void invoke("reminders:openSettings")}>
            Open Privacy Settings
          </Button>
        </Field>
      ) : null}
    </FieldSet>
  );
}
