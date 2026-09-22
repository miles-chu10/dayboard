import { Outlet, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { SplitView, Status } from "@glaze/core/components";
import { useTheme, useConnection, useEnvironment } from "@glaze/core/hooks";
import type { LaunchView } from "@main/shared-types";

import { AppSidebar } from "../components/app-sidebar";
import { CaptureProvider } from "../components/capture-dialog";
import { MeetingPrepProvider } from "../components/meeting-prep-dialog";
import { useAccentSync } from "../lib/accent";
import { useBackendSync } from "../lib/queries";
import { useSettings } from "../lib/settings";

const LAUNCH_ROUTE: Record<
  LaunchView,
  "/" | "/tasks" | "/reminders" | "/mail" | "/calendar" | "/assistant" | "/review"
> = {
  today: "/",
  tasks: "/tasks",
  reminders: "/reminders",
  mail: "/mail",
  calendar: "/calendar",
  assistant: "/assistant",
  review: "/review",
};

export function RootView() {
  useTheme();
  useBackendSync();
  useAccentSync();

  // IPC connection and environment
  const connectionQuery = useConnection();
  const environmentQuery = useEnvironment();
  const settings = useSettings().data;
  const navigate = useNavigate();
  const launched = React.useRef(false);

  // Open the launch view chosen in Settings, once per app session.
  React.useEffect(() => {
    if (!settings || launched.current) return;
    launched.current = true;
    const route = LAUNCH_ROUTE[settings.general.launchView];
    if (route !== "/") void navigate({ to: route });
  }, [settings, navigate]);

  // Cleanup IPC connection on unmount
  React.useEffect(() => {
    return () => {
      console.log("[RootView] cleanup - disconnecting IPC client");
      window.glazeAPI?.glaze?.ipc?.disconnect();
    };
  }, []);

  return (
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
      {/* Draggable top bar - fallback for when no toolbar is present */}
      <div className="drag-region fixed top-0 left-0 right-0 h-13" />
      <CaptureProvider>
        <MeetingPrepProvider>
          <SplitView className="h-full" storageKey="productivity-shell" sidebar={<AppSidebar />}>
            <Outlet />
          </SplitView>
        </MeetingPrepProvider>
      </CaptureProvider>

      <div className="flex flex-col items-end gap-1 mt-2 fixed bottom-12 right-2">
        {import.meta.env.DEV ? (
          <>
            {connectionQuery.error ? <Status variant="error">Backend disconnected</Status> : null}
            {environmentQuery.data ? null : <Status variant="error">Dev Server not found</Status>}
          </>
        ) : null}
      </div>
    </div>
  );
}
