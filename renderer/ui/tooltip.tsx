import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "./utils";

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <TooltipPrimitive.Provider delayDuration={400}>{children}</TooltipPrimitive.Provider>;
}

export function Tooltip({ open, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root open={open} {...props} />;
}

export const TooltipTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof TooltipPrimitive.Trigger>
>((props, ref) => <TooltipPrimitive.Trigger ref={ref} {...props} />);
TooltipTrigger.displayName = "TooltipTrigger";

export interface TooltipContentProps extends React.ComponentProps<typeof TooltipPrimitive.Content> {
  shortcut?: string[];
}

export const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  ({ className, side = "top", sideOffset = 6, shortcut, children, ...props }, ref) => (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex items-center gap-1.5 rounded-lg border border-separator bg-background/95 px-2 py-1 text-small text-primary shadow-lg backdrop-blur-xl",
          "data-[state=delayed-open]:animate-fade-in",
          className,
        )}
        {...props}
      >
        {children}
        {shortcut?.length ? (
          <span className="flex items-center gap-0.5">
            {shortcut.map((key, index) => (
              <kbd
                key={`${key}-${index}`}
                className="flex h-4 min-w-4 items-center justify-center rounded bg-control px-1 text-[10px] font-medium text-secondary"
              >
                {key}
              </kbd>
            ))}
          </span>
        ) : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  ),
);
TooltipContent.displayName = "TooltipContent";
