import { useRouterState } from "@tanstack/react-router";
import { Button } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
import { CalendarDays, MessageCircle, RotateCw } from "lucide-react";

import { featureOn, sourceOn, useSettings } from "../lib/settings";
import { NewItemButton } from "./new-item-button";
import { useShell } from "./shell";
import { UpdateReadyButton } from "./update-ready-button";

/** Window-level controls every view's header carries: the update prompt and the details toggle. */
export function WindowActions() {
  return (
    <>
      <UpdateReadyButton />
      <div data-inspector-controls className="flex items-center empty:hidden" />
      <PaneToggles />
    </>
  );
}

/** HeroSpace-style toggles for the right pane: a day calendar or the docked Assistant. */
function PaneToggles() {
  const { rightPane, toggleRightPane } = useShell();
  const settings = useSettings().data;
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const calendarOn = sourceOn(settings, "calendar") && pathname !== "/calendar";
  const agentOn = featureOn(settings, "assistant") && pathname !== "/assistant";
  return (
    <>
      {calendarOn ? (
        <Button
          iconOnly
          variant={rightPane === "calendar" ? "muted" : "filled"}
          className={cn(rightPane === "calendar" && "text-accent")}
          aria-pressed={rightPane === "calendar"}
          aria-label="Calendar beside this page"
          title="Calendar beside this page (⌥⌘K)"
          onClick={() => toggleRightPane("calendar")}
        >
          <CalendarDays />
        </Button>
      ) : null}
      {agentOn ? (
        <Button
          variant={rightPane === "agent" ? "muted" : "filled"}
          className={cn(rightPane === "agent" && "text-accent")}
          aria-pressed={rightPane === "agent"}
          aria-label="Ask Assistant"
          title="Ask Assistant beside this page (⌥⌘J)"
          onClick={() => toggleRightPane("agent")}
        >
          <MessageCircle />
          Ask
        </Button>
      ) : null}
    </>
  );
}

export function ViewActions({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return (
    <>
      <WindowActions />
      <NewItemButton />
      <Button
        iconOnly
        aria-label="Refresh"
        title="Refresh"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <RotateCw />
      </Button>
    </>
  );
}
