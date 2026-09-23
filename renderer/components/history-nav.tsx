import { useEffect, useReducer } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@renderer/ui";
import { ArrowLeft, ArrowRight } from "lucide-react";

function useHistoryState() {
  const router = useRouter();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => router.history.subscribe(rerender), [router]);
  const index = router.history.location.state.__TSR_index ?? 0;
  return {
    canBack: index > 0,
    canForward: index < router.history.length - 1,
    back: () => router.history.back(),
    forward: () => router.history.forward(),
  };
}

/** ⌘[ and ⌘] move through view history, like Safari and Finder. */
export function useHistoryShortcuts() {
  const router = useRouter();
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const index = router.history.location.state.__TSR_index ?? 0;
      if (event.key === "[" && index > 0) {
        event.preventDefault();
        router.history.back();
      } else if (event.key === "]" && index < router.history.length - 1) {
        event.preventDefault();
        router.history.forward();
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [router]);
}

export function HistoryNav() {
  const nav = useHistoryState();
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex">
            <Button iconOnly aria-label="Back" onClick={nav.back} disabled={!nav.canBack}>
              <ArrowLeft />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" shortcut={["⌘", "["]}>
          Back
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="flex">
            <Button iconOnly aria-label="Forward" onClick={nav.forward} disabled={!nav.canForward}>
              <ArrowRight />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" shortcut={["⌘", "]"]}>
          Forward
        </TooltipContent>
      </Tooltip>
    </>
  );
}
