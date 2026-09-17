import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  ScrollArea,
  Status,
  Toolbar,
  ToolbarContent,
  ToolbarTitle,
  Field,
  FieldContent,
  FieldLabel,
  FieldSet,
  toast,
} from "@glaze/core/components";
import type { NativeThemeInfo } from "@glaze/core/ipc";
import type { AccountsStatus, GoogleAccountStatus, RemindersAccess } from "@main/shared-types";

import { errorMessage, invoke, openExternal } from "../lib/ipc";
import { queryKeys, useAccounts, useAccountsSync, useConnectGoogle, useRequestRemindersAccess } from "../lib/queries";

const GOOGLE_REDIRECT_URI = "https://www.glaze.app/api/oauth/callback";

export function SettingsView() {
  useAccountsSync();
  const accounts = useAccounts();
  const [themeInfo, setThemeInfo] = useState<NativeThemeInfo | null>(null);

  // Close settings window on Escape, unless an interactive element is focused or a popover is open
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;

      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }

      if (document.querySelector("[data-radix-popper-content-wrapper]")) {
        return;
      }

      event.preventDefault();
      window.glazeAPI.glaze.ipc.invoke("window:closeSettings");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const refreshThemeInfo = async () => {
    try {
      setThemeInfo(await window.glazeAPI.nativeTheme.getInfo());
    } catch (error) {
      toast.error(`Failed to get theme info: ${error}`);
    }
  };

  useEffect(() => {
    refreshThemeInfo();
  }, []);

  const handleThemeChange = async (value: string) => {
    const source = value as "system" | "light" | "dark";
    try {
      await window.glazeAPI.nativeTheme.setThemeSource(source);
      await refreshThemeInfo();
    } catch (error) {
      toast.error(`Failed to set theme: ${error}`);
    }
  };

  return (
    <ScrollArea
      toolbar={
        <Toolbar>
          <ToolbarContent>
            <ToolbarTitle>Settings</ToolbarTitle>
          </ToolbarContent>
        </Toolbar>
      }
    >
      <div className="px-4 flex flex-col gap-8 mb-8">
        <GoogleSettings status={accounts.data?.google} />
        {accounts.data && !accounts.data.google.connected ? <GoogleSetupGuide /> : null}
        <RemindersSettings access={accounts.data?.reminders} />
        <FieldSet title="Appearance">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="theme">Theme</FieldLabel>
            </FieldContent>
            <RadioGroup
              value={themeInfo?.themeSource ?? "system"}
              onValueChange={handleThemeChange}
              orientation="horizontal"
            >
              <Label>
                <RadioGroupItem value="system" />
                Auto
              </Label>
              <Label>
                <RadioGroupItem value="light" />
                Light
              </Label>
              <Label>
                <RadioGroupItem value="dark" />
                Dark
              </Label>
            </RadioGroup>
          </Field>
        </FieldSet>
      </div>
    </ScrollArea>
  );
}

function GoogleSettings({ status }: { status: GoogleAccountStatus | undefined }) {
  const queryClient = useQueryClient();
  const connect = useConnectGoogle();
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const onAccountsChanged = (next: AccountsStatus) => queryClient.setQueryData(queryKeys.accounts, next);

  const save = useMutation({
    mutationFn: () => invoke<AccountsStatus>("google:saveCredentials", { clientId, clientSecret }),
    onSuccess: (next) => {
      onAccountsChanged(next);
      setEditing(false);
      setClientId("");
      setClientSecret("");
      toast.success("Google client saved. Now connect your account.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const disconnect = useMutation({
    mutationFn: () => invoke<AccountsStatus>("google:disconnect"),
    onSuccess: (next) => {
      onAccountsChanged(next);
      toast.success("Google account disconnected");
    },
    onError: (error) => toast.error(`Couldn't disconnect: ${errorMessage(error)}`),
  });

  const removeClient = useMutation({
    mutationFn: () => invoke<AccountsStatus>("google:clearCredentials"),
    onSuccess: onAccountsChanged,
    onError: (error) => toast.error(`Couldn't remove client: ${errorMessage(error)}`),
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
      <FieldSet title="Google Account" description="Google Tasks, Gmail, and Google Calendar.">
        <Field label="Account" description={status.email ?? "Signed in"}>
          <Status variant="success">Connected</Status>
        </Field>
        <Field>
          <Button onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            Disconnect
          </Button>
        </Field>
      </FieldSet>
    );
  }

  if (!status.hasCredentials || editing) {
    return (
      <FieldSet
        title="Google Account"
        description="Paste the OAuth client from your Google Cloud project. It's stored encrypted on this Mac."
      >
        <Field label="Client ID">
          <Input
            className="w-64"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            placeholder="….apps.googleusercontent.com"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Client Secret">
          <Input
            className="w-64"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            placeholder="GOCSPX-…"
            autoComplete="off"
          />
        </Field>
        <Field>
          {editing ? <Button onClick={() => setEditing(false)}>Cancel</Button> : null}
          <Button
            variant="accent"
            onClick={() => save.mutate()}
            disabled={!clientId.trim() || !clientSecret.trim() || save.isPending}
          >
            Save Client
          </Button>
        </Field>
      </FieldSet>
    );
  }

  return (
    <FieldSet title="Google Account" description="Google Tasks, Gmail, and Google Calendar.">
      <Field label="OAuth Client" description={`Client ID ${status.clientIdHint ?? "saved"}`}>
        <Button size="small" onClick={() => setEditing(true)}>
          Change
        </Button>
      </Field>
      <Field label="Account" description="You'll sign in with Google in your browser.">
        <Status variant="neutral">Not connected</Status>
      </Field>
      <Field>
        <Button onClick={() => removeClient.mutate()} disabled={removeClient.isPending}>
          Remove Client
        </Button>
        <Button variant="accent" onClick={() => connect.mutate()} disabled={connect.isPending}>
          {connect.isPending ? "Waiting for Browser…" : "Connect Google Account"}
        </Button>
      </Field>
    </FieldSet>
  );
}

function GoogleSetupGuide() {
  const copyRedirect = async () => {
    try {
      await invoke("google:copyRedirectUri");
      toast.success("Redirect URI copied");
    } catch (error) {
      toast.error(`Couldn't copy: ${errorMessage(error)}`);
    }
  };

  return (
    <FieldSet title="Google Cloud Setup" description="One-time setup, about five minutes.">
      <Field label="1. Create a project" description="Create a new project in Google Cloud Console. Any name works.">
        <Button size="small" onClick={() => void openExternal("https://console.cloud.google.com/projectcreate")}>
          Open Console
        </Button>
      </Field>
      <Field label="2. Enable APIs" description="Enable the Google Tasks API, Gmail API, and Google Calendar API.">
        <Button size="small" onClick={() => void openExternal("https://console.cloud.google.com/apis/library")}>
          API Library
        </Button>
      </Field>
      <Field
        label="3. Configure consent"
        description="Set up the OAuth consent screen as External, then add your Google address under Test users."
      >
        <Button size="small" onClick={() => void openExternal("https://console.cloud.google.com/auth/overview")}>
          Consent Screen
        </Button>
      </Field>
      <Field
        label="4. Create a client"
        description="Create an OAuth client ID of type Web application and add the redirect URI below."
      >
        <Button size="small" onClick={() => void openExternal("https://console.cloud.google.com/auth/clients")}>
          Clients
        </Button>
      </Field>
      <Field label="Redirect URI" description={GOOGLE_REDIRECT_URI}>
        <Button size="small" onClick={() => void copyRedirect()}>
          Copy
        </Button>
      </Field>
      <Field
        label="5. Paste credentials"
        description="Copy the Client ID and Client Secret into Google Account above, save, then connect."
      />
    </FieldSet>
  );
}

function RemindersSettings({ access }: { access: RemindersAccess | undefined }) {
  const request = useRequestRemindersAccess();

  const status =
    access === undefined
      ? { variant: "loading" as const, label: "Checking…", description: "Show and complete your Apple Reminders." }
      : access === "full-access"
        ? { variant: "success" as const, label: "Allowed", description: "Your reminders appear on the dashboard." }
        : access === "not-determined"
          ? { variant: "neutral" as const, label: "Not allowed", description: "Show and complete your Apple Reminders." }
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
          <Button onClick={() => void invoke("reminders:openSettings")}>Open Privacy Settings</Button>
        </Field>
      ) : null}
    </FieldSet>
  );
}
