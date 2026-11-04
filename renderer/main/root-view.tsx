import { Outlet, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { SplitView, useSplitView } from "@renderer/ui";
import { useTheme } from "@renderer/hooks";
import type { LaunchView } from "@main/shared-types";

import { AppSidebar } from "../components/app-sidebar";
import { CaptureProvider } from "../components/capture-dialog";
import { MeetingPrepProvider } from "../components/meeting-prep-dialog";
import { useHistoryShortcuts } from "../components/history-nav";
import { useAppearanceSync } from "../lib/appearance";
import { useAgendaState, useBackendSync } from "../lib/queries";
import { useSettings } from "../lib/settings";
import { invoke } from "../lib/ipc";

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

const ROUTE_BY_PATH: Record<string, (typeof LAUNCH_ROUTE)[LaunchView]> = Object.fromEntries(
  Object.values(LAUNCH_ROUTE).map((route) => [route, route]),
);

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

  // Panels and notifications open a view here: pulled once if this window opened for it, then
  // pushed while the window lives. Either one replaces the launch view.
  React.useEffect(() => {
    const go = (value: unknown) => {
      const target = value as { to?: unknown; prompt?: unknown } | null;
      if (!target || typeof target.to !== "string" || !(target.to in ROUTE_BY_PATH)) return;
      launched.current = true;
      const to = ROUTE_BY_PATH[target.to];
      if (to === "/assistant" && typeof target.prompt === "string")
        void navigate({ to, search: { prompt: target.prompt } });
      else void navigate({ to });
    };
    void invoke<unknown>("app:takeNavigation").then(go, () => undefined);
    return window.dayboard.ipc.onNotification("app:navigate", go);
  }, [navigate]);

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
            sidebarSize={{ default: 220, min: 180, max: 400 }}
            primarySize={{ min: 440 }}
          >
            <SidebarControl />
            <div data-window-content className="h-full min-h-0 bg-background">
              <Outlet />
            </div>
          </SplitView>
        </MeetingPrepProvider>
      </CaptureProvider>
    </div>
  );
}

/** Each view's header holds history and actions; the sidebar toggle stays beside the traffic lights. */
function SidebarControl() {
  const { toggleSidebar } = useSplitView();
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
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return;
      event.preventDefault();
      toggleSidebar();
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [toggleSidebar]);
  return (
    <SplitView.SidebarToggle
      pinned={false}
      radius="rounded"
      className="fixed left-[92px] top-[12px] z-20"
    />
  );
}
