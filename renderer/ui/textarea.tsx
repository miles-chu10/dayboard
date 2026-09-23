import * as React from "react";

import { cn } from "./utils";

const SIZE_CLASS = {
  small: "min-h-14 px-2",
  medium: "min-h-14 px-3",
  large: "min-h-18 px-3",
} as const;

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  size?: keyof typeof SIZE_CLASS;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size = "medium", ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none [field-sizing:content] max-h-32 rounded-lg border border-field bg-transparent py-2 text-regular text-primary",
        "placeholder:text-tertiary outline-none transition-colors",
        "focus:border-primary/40 aria-invalid:border-support-red/40",
        "disabled:cursor-not-allowed disabled:opacity-40",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
