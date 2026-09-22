import type { ReactNode } from "react";
import { Button, Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import { X } from "lucide-react";

/** Non-modal container for item details, used inline under a row and in the right-hand panel. */
export function DetailPanel({
  title,
  subtitle,
  onClose,
  footer,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={`${title} details`}
      className={cn("flex min-w-0 flex-col gap-3 rounded-lg bg-well p-3", className)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text variant="strong" className="break-words">
            {title}
          </Text>
          {subtitle ? (
            <Text variant="small" color="secondary" truncate>
              {subtitle}
            </Text>
          ) : null}
        </div>
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label="Close details"
          title="Close"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      {children}
      {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
    </section>
  );
}
