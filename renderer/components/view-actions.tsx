import { Button } from "@renderer/ui";
import { RotateCw } from "lucide-react";

import { NewItemButton } from "./new-item-button";

export function ViewActions({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing?: boolean;
}) {
  return (
    <>
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
