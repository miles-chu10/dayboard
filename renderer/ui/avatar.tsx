import * as React from "react";
import { Avatar as AvatarPrimitive } from "radix-ui";

import { cn } from "./utils";

const SIZE_CLASS = {
  small: "size-6 text-small",
  medium: "size-8 text-regular",
  large: "size-10 text-large",
} as const;

export interface AvatarProps extends React.ComponentProps<typeof AvatarPrimitive.Root> {
  size?: keyof typeof SIZE_CLASS;
}

export const Avatar = React.forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ className, size = "medium", ...props }, ref) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
Avatar.displayName = "Avatar";

export const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  React.ComponentProps<typeof AvatarPrimitive.Image>
>(({ className, draggable = false, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    draggable={draggable}
    onContextMenu={(event) => event.preventDefault()}
    className={cn("size-full object-cover", className)}
    {...props}
  />
));
AvatarImage.displayName = "AvatarImage";

export const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentProps<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex size-full items-center justify-center bg-control font-medium text-secondary",
      className,
    )}
    {...props}
  />
));
AvatarFallback.displayName = "AvatarFallback";

const BADGE_COLOR_CLASS: Record<string, string> = {
  gray: "bg-quaternary",
  blue: "bg-support-blue",
  green: "bg-support-green",
  yellow: "bg-support-yellow",
  orange: "bg-support-orange",
  red: "bg-support-red",
  pink: "bg-support-magenta",
};

const POSITION_CLASS = {
  "bottom-right": "bottom-0 right-0",
  "top-right": "top-0 right-0",
  "bottom-left": "bottom-0 left-0",
  "top-left": "top-0 left-0",
} as const;

export interface AvatarBadgeProps extends React.ComponentProps<"span"> {
  color?: keyof typeof BADGE_COLOR_CLASS;
  position?: keyof typeof POSITION_CLASS;
}

export function AvatarBadge({
  color = "green",
  position = "bottom-right",
  className,
  children,
  ...props
}: AvatarBadgeProps) {
  return (
    <span
      className={cn(
        "absolute rounded-full ring-2 ring-background",
        children
          ? "flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[8px] font-semibold text-white"
          : "size-2",
        BADGE_COLOR_CLASS[color] ?? color,
        POSITION_CLASS[position],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export function AvatarStack({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex -space-x-2", className)} {...props} />;
}
