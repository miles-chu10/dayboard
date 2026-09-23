import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "./utils";
import { MenuIcon, type NativeMenuIcon } from "./menu-icon";

export function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />;
}

const TRIGGER_VARIANT = {
  default: "bg-transparent border border-field",
  filled: "bg-control-subtle border border-transparent",
  transparent: "bg-transparent border border-transparent hover:bg-control-subtle",
  glass: "bg-well/70 border border-transparent backdrop-blur",
} as const;

const TRIGGER_SIZE = {
  small: "h-7 px-2 text-small",
  medium: "h-8 px-2.5 text-regular",
  large: "h-9 px-3 text-regular",
} as const;

export interface SelectTriggerProps extends Omit<
  React.ComponentProps<typeof SelectPrimitive.Trigger>,
  "onClick" | "onKeyDown"
> {
  variant?: keyof typeof TRIGGER_VARIANT;
  size?: keyof typeof TRIGGER_SIZE;
  shape?: "default" | "pill";
  hideChevron?: boolean;
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (
    {
      className,
      variant = "default",
      size = "medium",
      shape = "default",
      hideChevron,
      children,
      ...props
    },
    ref,
  ) => (
    <SelectPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center gap-1.5 outline-none transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-40",
        shape === "pill" ? "rounded-full" : "rounded-lg",
        TRIGGER_VARIANT[variant],
        TRIGGER_SIZE[size],
        className,
      )}
      {...props}
    >
      {children}
      {hideChevron ? null : (
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-3.5 shrink-0 text-tertiary" />
        </SelectPrimitive.Icon>
      )}
    </SelectPrimitive.Trigger>
  ),
);
SelectTrigger.displayName = "SelectTrigger";

export function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      className={cn("min-w-0 flex-1 truncate text-left", className)}
      {...props}
    />
  );
}

export function SelectContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={cn(
          "z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-separator bg-background/95 shadow-xl backdrop-blur-xl",
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export interface SelectItemProps extends React.ComponentProps<typeof SelectPrimitive.Item> {
  sublabel?: string;
  icon?: NativeMenuIcon;
}

export const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  ({ className, children, sublabel, icon, ...props }, ref) => (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-lg py-1.5 pl-7 pr-2 text-regular text-primary outline-none",
        "data-[highlighted]:bg-list-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex size-4 items-center justify-center">
        <Check className="size-3.5" />
      </SelectPrimitive.ItemIndicator>
      <MenuIcon icon={icon} className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {sublabel ? (
          <span className="block truncate text-small text-tertiary">{sublabel}</span>
        ) : null}
      </span>
    </SelectPrimitive.Item>
  ),
);
SelectItem.displayName = "SelectItem";

export function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group {...props} />;
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2 py-1 text-small text-tertiary", className)}
      {...props}
    />
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn("my-1 h-px bg-separator", className)} {...props} />
  );
}
