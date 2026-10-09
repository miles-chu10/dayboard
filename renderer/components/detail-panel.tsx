import { useEffect, useRef, type ReactNode } from "react";
import { Button, Text } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";
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
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = panel.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.focus({ preventScroll: true });
    return () => {
      if (
        trigger?.isConnected &&
        (document.activeElement === document.body || node?.contains(document.activeElement))
      ) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <section
      ref={panel}
      tabIndex={-1}
      aria-label={`${title} details`}
      className={cn(
        "@container/detail flex min-w-0 flex-col gap-3 rounded-lg bg-well p-3",
        className,
      )}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !document.querySelector('[role="dialog"], [role="alertdialog"]') &&
          event.currentTarget.contains(event.target as Node)
        ) {
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
