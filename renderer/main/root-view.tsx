import { Outlet, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { SplitView } from "@renderer/ui";
import { useTheme } from "@renderer/hooks";
import type { LaunchView } from "@main/shared-types";

import { AppSidebar } from "../components/app-sidebar";
import { CaptureProvider } from "../components/capture-dialog";
import { MeetingPrepProvider } from "../components/meeting-prep-dialog";
import { useHistoryShortcuts } from "../components/history-nav";
import { useAppearanceSync } from "../lib/appearance";
import { useAgendaState, useBackendSync } from "../lib/queries";
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
  // Every route can create or change source items. Hydrate the backend-owned
  // account scope before those actions, including direct launch into Sources.
  useAgendaState();
  useAppearanceSync();
  useHistoryShortcuts();

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

  return (
    <div className="h-full relative [&:not(:has([data-toolbar]))_.drag-region]:z-50">
      {/* Draggable top bar - fallback for when no toolbar is present */}
      <div className="drag-region fixed top-0 left-0 right-0 h-13" />
      <CaptureProvider>
        <MeetingPrepProvider>
          <SplitView
            className="h-full"
            storageKey="productivity-shell"
            sidebar={<AppSidebar />}
            sidebarSize={{ default: 220, min: 180, max: 400 }}
          >
            <Outlet />
          </SplitView>
        </MeetingPrepProvider>
      </CaptureProvider>
    </div>
  );
}
