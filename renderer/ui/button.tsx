import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors " +
    "disabled:pointer-events-none disabled:opacity-40 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent " +
    "[&>svg]:shrink-0",
  {
    variants: {
      variant: {
        filled: "bg-control text-primary hover:bg-control/80 active:bg-control",
        muted: "bg-control-subtle text-primary hover:bg-control",
        accent: "bg-accent text-accent-contrast hover:opacity-90 active:opacity-80",
        destructive: "bg-support-red text-white hover:opacity-90 active:opacity-80",
        glass: "bg-well/70 text-primary backdrop-blur hover:bg-control",
        glassAccent: "bg-accent/90 text-accent-contrast backdrop-blur hover:bg-accent",
        transparent: "bg-transparent text-primary hover:bg-control-subtle",
      },
      size: {
        small: "h-7 px-2.5 text-small [&>svg]:size-4",
        medium: "h-8 px-3 text-regular [&>svg]:size-[18px]",
        large: "h-9 px-3.5 text-regular [&>svg]:size-5",
      },
      radius: {
        full: "rounded-full",
        rounded: "rounded-lg",
      },
      iconOnly: {
        true: "p-0 shrink-0",
        false: "",
      },
    },
    compoundVariants: [
      { iconOnly: true, size: "small", className: "size-7" },
      { iconOnly: true, size: "medium", className: "size-8" },
      { iconOnly: true, size: "large", className: "size-9" },
    ],
    defaultVariants: {
      variant: "filled",
      size: "medium",
      radius: "full",
      iconOnly: false,
    },
  },
);

export interface ButtonProps
  extends
    Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "size">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, radius, iconOnly, asChild, type = "button", ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(buttonVariants({ variant, size, radius, iconOnly }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
