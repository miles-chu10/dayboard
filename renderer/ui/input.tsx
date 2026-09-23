import * as React from "react";

import { cn } from "./utils";

const SIZE_CLASS = {
  small: "h-7 px-2 text-small rounded-md",
  medium: "h-8 px-2.5 text-regular rounded-lg",
  large: "h-9 px-3 text-regular rounded-lg",
} as const;

const VARIANT_CLASS = {
  default: "bg-transparent border border-field",
  filled: "bg-control-subtle border border-transparent",
} as const;

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  variant?: keyof typeof VARIANT_CLASS;
  size?: keyof typeof SIZE_CLASS;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, variant = "default", size = "medium", type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "w-full min-w-0 text-primary placeholder:text-tertiary outline-none transition-colors",
        "focus:border-primary/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
        "aria-invalid:border-support-red/40",
        "disabled:cursor-not-allowed disabled:opacity-40",
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
