import { Toaster as Sonner, toast } from "sonner";
import type { ComponentProps } from "react";

export { toast };

export function Toaster(props: ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      position="bottom-center"
      expand
      toastOptions={{
        classNames: {
          toast:
            "group rounded-xl border border-separator bg-background/95 text-primary shadow-xl backdrop-blur-xl",
          title: "text-regular font-medium",
          description: "text-small text-secondary",
          actionButton: "!bg-accent !text-accent-contrast",
          cancelButton: "!bg-control !text-primary",
        },
      }}
      {...props}
    />
  );
}
