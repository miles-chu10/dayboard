import * as React from "react";
import { Slot } from "radix-ui";

import { cn } from "./utils";

export type StatusVariant = "neutral" | "loading" | "error" | "warning" | "success";

const DOT_CLASS: Record<StatusVariant, string> = {
  neutral: "bg-tertiary",
  loading: "bg-support-blue animate-pulse",
  error: "bg-support-red",
  warning: "bg-support-orange",
  success: "bg-support-green",
};

export interface StatusProps extends React.ComponentProps<"span"> {
  variant?: StatusVariant;
  asChild?: boolean;
}

export function Status({
  variant = "loading",
  asChild,
  className,
  children,
  ...props
}: StatusProps) {
  const dot = (
    <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASS[variant])} />
  );
  const rowClassName = cn("inline-flex items-center gap-1.5 text-small text-secondary", className);

  if (asChild) {
    return (
      <Slot.Root className={rowClassName} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <span className={rowClassName} {...props}>
      {dot}
      {children}
    </span>
  );
}
