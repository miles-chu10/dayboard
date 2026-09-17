import { Button } from "@glaze/core/components";
import { Plus, RotateCw } from "lucide-react";

import { useOpenCapture } from "./capture-dialog";

export function ViewActions({ onRefresh, refreshing }: { onRefresh: () => void; refreshing?: boolean }) {
  const openCapture = useOpenCapture();
  return (
    <>
      <Button iconOnly aria-label="New task, reminder, or event" title="New item" onClick={openCapture}>
        <Plus />
      </Button>
      <Button iconOnly aria-label="Refresh" title="Refresh" onClick={onRefresh} disabled={refreshing}>
        <RotateCw />
      </Button>
    </>
  );
}
