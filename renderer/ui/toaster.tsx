import { Toaster as Sonner, toast } from "sonner";
import type { ComponentProps, CSSProperties } from "react";

export { toast };

// Sonner's own styles outrank Tailwind's layered classes and default to its light palette, which
// painted near-black text on DayBoard's dark background. Its color variables take DayBoard's
// tokens instead, so toasts follow light and dark mode.
const PALETTE = {
  "--normal-bg": "color-mix(in oklab, var(--color-background) 95%, transparent)",
  "--normal-border": "var(--color-separator)",
  "--normal-text": "var(--color-primary)",
} as CSSProperties;

export function Toaster(props: ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      position="bottom-center"
      expand
      style={PALETTE}
      toastOptions={{
        classNames: {
          toast: "group rounded-xl shadow-xl backdrop-blur-xl",
          title: "text-regular font-medium",
          description: "text-small !text-secondary",
          actionButton: "!bg-accent !text-accent-contrast",
          cancelButton: "!bg-control !text-primary",
        },
      }}
      {...props}
    />
  );
}
