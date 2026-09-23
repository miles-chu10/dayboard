import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";

import { cn } from "./utils";

export const TabsRoot = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentProps<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Root ref={ref} className={cn(className)} {...props} />
));
TabsRoot.displayName = "TabsRoot";

const VARIANT_CLASS = {
  glass: "bg-well/70 backdrop-blur",
  filled: "bg-control-subtle",
  transparent: "bg-transparent",
} as const;

const SIZE_CLASS = {
  small: "h-7 p-0.5",
  medium: "h-8 p-0.5",
  large: "h-9 p-1",
} as const;

export interface TabsProps extends React.ComponentProps<typeof TabsPrimitive.List> {
  variant?: keyof typeof VARIANT_CLASS;
  size?: keyof typeof SIZE_CLASS;
}

export const Tabs = React.forwardRef<React.ElementRef<typeof TabsPrimitive.List>, TabsProps>(
  ({ className, variant = "glass", size = "medium", ...props }, ref) => (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
Tabs.displayName = "Tabs";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentProps<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex h-full items-center rounded-full px-3 text-small font-medium text-secondary outline-none transition-colors",
      "hover:text-primary data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "disabled:pointer-events-none disabled:opacity-40",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentProps<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn("outline-none", className)} {...props} />
));
TabsContent.displayName = "TabsContent";

export function TabsSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("mx-0.5 h-4 w-px bg-separator", className)} {...props} />;
}
