import { Button } from "@renderer/ui";
import { RotateCw } from "lucide-react";

import { NewItemButton } from "./new-item-button";
import { UpdateReadyButton } from "./update-ready-button";

/** Window-level controls every view's header carries: the update prompt and the details toggle. */
export function WindowActions() {
  return (
    <>
      <UpdateReadyButton />
      <div data-inspector-controls className="flex items-center empty:hidden" />
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
