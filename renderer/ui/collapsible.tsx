import * as React from "react";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { ChevronRight, type LucideProps } from "lucide-react";

import { cn } from "./utils";

const AnimatedContext = React.createContext(true);

export interface CollapsibleRootProps extends React.ComponentProps<
  typeof CollapsiblePrimitive.Root
> {
  animated?: boolean;
}

export function CollapsibleRoot({ animated = true, className, ...props }: CollapsibleRootProps) {
  return (
    <AnimatedContext.Provider value={animated}>
      <CollapsiblePrimitive.Root className={cn(className)} {...props} />
    </AnimatedContext.Provider>
  );
}

export interface CollapsibleTriggerProps extends React.ComponentProps<
  typeof CollapsiblePrimitive.Trigger
> {
  variant?: "row" | "section";
}

export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, CollapsibleTriggerProps>(
  ({ variant = "row", className, ...props }, ref) => (
    <CollapsiblePrimitive.Trigger
      ref={ref}
      className={cn(
        "group flex items-center gap-1.5 text-left outline-none",
        variant === "section" && "text-small font-medium text-tertiary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className,
      )}
      {...props}
    />
  ),
);
CollapsibleTrigger.displayName = "CollapsibleTrigger";

export interface CollapsibleChevronProps extends Omit<LucideProps, "onToggle"> {
  onToggle?: () => void;
  open?: boolean;
}

export function CollapsibleChevron({
  onToggle,
  open,
  className,
  ...props
}: CollapsibleChevronProps) {
  if (onToggle) {
    return (
      <ChevronRight
        role="button"
        tabIndex={-1}
        aria-label="Toggle"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={cn(
          "size-3.5 shrink-0 text-tertiary transition-transform",
          open && "rotate-90",
          className,
        )}
        {...props}
      />
    );
  }
  return (
    <ChevronRight
      className={cn(
        "size-3.5 shrink-0 text-tertiary transition-transform",
        open !== undefined ? open && "rotate-90" : "group-data-[state=open]:rotate-90",
        className,
      )}
      {...props}
    />
  );
}

export type CollapsibleContentProps = React.ComponentProps<typeof CollapsiblePrimitive.Content>;

export function CollapsibleContent({ className, ...props }: CollapsibleContentProps) {
  const animated = React.useContext(AnimatedContext);
  return (
    <CollapsiblePrimitive.Content
      className={cn(
        "overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
        !animated && "[&]:!duration-0",
        className,
      )}
      {...props}
    />
  );
}
