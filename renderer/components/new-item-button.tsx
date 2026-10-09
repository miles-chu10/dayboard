import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@renderer/ui";
import { Plus } from "lucide-react";

import { useOpenCapture } from "./capture-dialog";

/** Opens the New Item dialog. ⌘N does the same from anywhere in the main window. */
export function NewItemButton() {
  const openCapture = useOpenCapture();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex">
          <Button iconOnly aria-label="New task, reminder, or event" onClick={openCapture}>
            <Plus />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" shortcut={["⌘", "N"]}>
        New item
      </TooltipContent>
    </Tooltip>
  );
}
