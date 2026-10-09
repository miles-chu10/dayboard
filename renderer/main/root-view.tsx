import { Outlet, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { SplitView, Toolbar, ToolbarRow, useSplitView } from "@renderer/ui";
import { useTheme } from "@renderer/hooks";
import type { LaunchView } from "@main/shared-types";

import { AppSidebar } from "../components/app-sidebar";
import { CaptureProvider } from "../components/capture-dialog";
import { MeetingPrepProvider } from "../components/meeting-prep-dialog";
import { HistoryNav, useHistoryShortcuts } from "../components/history-nav";
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
    <div className="h-full">
      <CaptureProvider>
        <MeetingPrepProvider>
          <SplitView
            className="h-full"
            storageKey="productivity-shell"
            sidebar={<AppSidebar />}
            sidebarSize={{ default: 240, min: 180, max: 400 }}
          >
            <div className="flex h-full min-h-0 flex-col">
              <WindowNavigation />
              <div className="min-h-0 flex-1">
                <Outlet />
              </div>
            </div>
          </SplitView>
        </MeetingPrepProvider>
      </CaptureProvider>
    </div>
  );
}

function WindowNavigation() {
  const { sidebarCollapsed, toggleSidebar } = useSplitView();
  React.useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== "s" ||
        !event.metaKey ||
        !event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.repeat ||
        event.isComposing ||
        event.defaultPrevented ||
        document.querySelector('[role="dialog"]')
      )
        return;
      event.preventDefault();
      toggleSidebar();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [toggleSidebar]);
  return (
    <Toolbar
      inset={sidebarCollapsed ? "windowControlsAndButton" : "none"}
      data-window-navigation
      className="window-navigation border-b border-separator/60"
    >
      <ToolbarRow className={`h-12 px-6 ${sidebarCollapsed ? "pl-[132px]" : ""}`}>
        <SplitView.SidebarToggle
          pinned={false}
          radius="rounded"
          className="fixed left-[92px] top-[10px] z-20"
        />
        <HistoryNav />
      </ToolbarRow>
    </Toolbar>
  );
}
