import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@renderer/ui";
import { Plus } from "lucide-react";

import { useOpenCapture } from "./capture-dialog";

/**
 * Opens the New Item dialog. ⌘N does the same from anywhere in the main window.
 * The wrapper sits above the window's fixed drag strip, which otherwise covers the sidebar
 * header and swallows clicks. Only the button's own (no-drag) area is raised, so the rest of
 * the strip still drags the window.
 */
export function NewItemButton() {
  const openCapture = useOpenCapture();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative z-10 flex">
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
