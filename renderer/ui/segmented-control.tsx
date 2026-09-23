import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "./utils";

const VARIANT_CLASS = {
  filled: "bg-control-subtle",
  glass: "bg-well/70 backdrop-blur",
  transparent: "bg-transparent",
} as const;

const SIZE_CLASS = {
  small: "h-7 p-0.5 text-small",
  medium: "h-8 p-0.5 text-regular",
  large: "h-9 p-1 text-regular",
} as const;

export interface SegmentedControlProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange" | "defaultValue"
> {
  type?: "single" | "multiple";
  allowEmpty?: boolean;
  value?: string | string[];
  defaultValue?: string | string[];
  onValueChange?: ((value: string) => void) | ((value: string[]) => void);
  disabled?: boolean;
  variant?: keyof typeof VARIANT_CLASS;
  size?: keyof typeof SIZE_CLASS;
}

export const SegmentedControl = React.forwardRef<HTMLDivElement, SegmentedControlProps>(
  (
    {
      className,
      type = "single",
      variant = "filled",
      size = "medium",
      allowEmpty = false,
      onValueChange,
      ...props
    },
    ref,
  ) => {
    const handleValueChange =
      type === "single" && !allowEmpty
        ? (value: string) => {
            if (value) (onValueChange as ((value: string) => void) | undefined)?.(value);
          }
        : onValueChange;
    const rootProps = {
      ...props,
      type,
      onValueChange: handleValueChange,
    } as Extract<React.ComponentProps<typeof ToggleGroupPrimitive.Root>, { type: typeof type }>;
    return (
      <ToggleGroupPrimitive.Root
        ref={ref}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-full",
          VARIANT_CLASS[variant],
          SIZE_CLASS[size],
          className,
        )}
        {...rootProps}
      />
    );
  },
);
SegmentedControl.displayName = "SegmentedControl";

export const SegmentedControlItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentProps<typeof ToggleGroupPrimitive.Item> & {
    iconOnly?: boolean;
  }
>(({ className, iconOnly, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "inline-flex h-full items-center justify-center rounded-full px-2.5 font-medium text-secondary outline-none transition-colors",
      "hover:text-primary data-[state=on]:bg-background data-[state=on]:text-primary data-[state=on]:shadow",
      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
      "disabled:pointer-events-none disabled:opacity-40",
      iconOnly && "aspect-square px-0 [&>svg]:size-4",
      className,
    )}
    {...props}
  />
));
SegmentedControlItem.displayName = "SegmentedControlItem";

export function SegmentedControlSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("mx-0.5 h-4 w-px bg-separator", className)} {...props} />;
}
