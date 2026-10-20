import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "./utils";

export function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root {...props} />;
}

export const PopoverTrigger = PopoverPrimitive.Trigger;

/** Positions the content against another element, or against `virtualRef` without rendering one. */
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  side = "top",
  align = "end",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-2xl border border-separator bg-background/95 p-3 shadow-xl outline-none backdrop-blur-xl",
          "origin-[--radix-popover-content-transform-origin]",
          "data-[state=open]:animate-scale-in data-[state=closed]:animate-scale-out",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
