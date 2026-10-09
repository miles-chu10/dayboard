import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@renderer/ui";
import { Plus } from "lucide-react";

import { useOpenCapture } from "./capture-dialog";

export function NewItemButton() {
  const openCapture = useOpenCapture();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          iconOnly
          aria-label="New task, reminder, or event"
          onClick={openCapture}
          // Keep the shipped button above the drag strip without raising the surrounding header.
          className="relative z-10"
        >
          <Plus />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" shortcut={["⌘", "N"]}>
        New item
      </TooltipContent>
    </Tooltip>
  );
}
