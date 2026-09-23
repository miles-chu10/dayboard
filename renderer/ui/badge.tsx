import * as React from "react";
import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "./utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap [&>svg]:shrink-0",
  {
    variants: {
      color: {
        primary: "bg-primary text-background",
        secondary: "bg-control text-secondary",
        blue: "bg-support-blue-10 text-support-blue",
        green: "bg-support-green-10 text-support-green",
        yellow: "bg-support-yellow-10 text-support-yellow",
        orange: "bg-support-orange-10 text-support-orange",
        red: "bg-support-red-10 text-support-red",
        purple: "bg-support-purple-10 text-support-purple",
        magenta: "bg-support-magenta-10 text-support-magenta",
      },
      size: {
        small: "h-5 px-2 text-small [&>svg]:size-3",
        medium: "h-6 px-2.5 text-regular [&>svg]:size-3.5",
      },
    },
    defaultVariants: { color: "secondary", size: "small" },
  },
);

export interface BadgeProps
  extends Omit<React.ComponentProps<"span">, "color">, VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

export function Badge({ className, color, size, asChild, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp className={cn(badgeVariants({ color, size }), className)} {...props} />;
}
