import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";

import { cn } from "./utils";
import { Button } from "./button";
import { ScrollArea } from "./scroll-area";

const SIZE_CLASS = {
  small: "w-[min(90vw,22rem)]",
  medium: "w-[min(90vw,28rem)]",
  large: "w-[min(90vw,36rem)]",
  xl: "w-[min(90vw,44rem)]",
  "2xl": "w-[min(90vw,56rem)]",
} as const;

type DialogSize = keyof typeof SIZE_CLASS;

export interface DialogAction {
  label: React.ReactNode;
  onClick: () => void | Promise<void>;
}

export interface DialogProps extends React.ComponentProps<typeof DialogPrimitive.Root> {
  trigger?: React.ReactNode;
  title?: React.ReactNode;
  hideTitle?: boolean;
  description?: React.ReactNode;
  hideDescription?: boolean;
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: React.ReactNode;
  confirmVariant?: "accent" | "destructive";
  confirmDisabled?: boolean;
  destructiveAction?: DialogAction;
  secondaryAction?: DialogAction;
  size?: DialogSize;
  showOverlay?: boolean;
  children?: React.ReactNode;
}

export function Dialog({
  trigger,
  title,
  hideTitle,
  description,
  hideDescription,
  onConfirm,
  confirmLabel = "Done",
  confirmVariant = "accent",
  confirmDisabled,
  destructiveAction,
  secondaryAction,
  size = "medium",
  showOverlay = true,
  children,
  ...rootProps
}: DialogProps) {
  const propsMode =
    trigger !== undefined ||
    title !== undefined ||
    description !== undefined ||
    onConfirm !== undefined;
  const [pending, setPending] = React.useState(false);

  if (!propsMode) {
    return <DialogPrimitive.Root {...rootProps}>{children}</DialogPrimitive.Root>;
  }

  return (
    <DialogPrimitive.Root {...rootProps}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogContent size={size} overlayClassName={showOverlay ? undefined : "hidden"}>
        {title ? (
          <DialogHeader>
            <DialogTitle className={cn(hideTitle && "sr-only")}>{title}</DialogTitle>
            {description ? (
              <DialogDescription className={cn(hideDescription && "sr-only")}>
                {description}
              </DialogDescription>
            ) : null}
          </DialogHeader>
        ) : null}
        <DialogBody>{children}</DialogBody>
        {onConfirm || destructiveAction || secondaryAction ? (
          <DialogFooter>
            {destructiveAction ? (
              <Button variant="filled" onClick={() => void destructiveAction.onClick()}>
                {destructiveAction.label}
              </Button>
            ) : null}
            {secondaryAction ? (
              <Button variant="filled" onClick={() => void secondaryAction.onClick()}>
                {secondaryAction.label}
              </Button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <DialogPrimitive.Close asChild>
                <Button variant="filled">Cancel</Button>
              </DialogPrimitive.Close>
              {onConfirm ? (
                <Button
                  variant={confirmVariant}
                  disabled={confirmDisabled || pending}
                  onClick={async () => {
                    setPending(true);
                    try {
                      await onConfirm();
                    } finally {
                      setPending(false);
                    }
                  }}
                >
                  {confirmLabel}
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </DialogPrimitive.Root>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps extends React.ComponentProps<typeof DialogPrimitive.Content> {
  size?: DialogSize;
  showCloseButton?: boolean;
  overlayClassName?: string;
}

export function DialogContent({
  size = "medium",
  showCloseButton,
  overlayClassName,
  className,
  children,
  ...props
}: DialogContentProps) {
  const content = (
    <DialogPrimitive.Content
      className={cn(
        "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
        "flex max-h-[85vh] flex-col rounded-xl border border-separator bg-background shadow-2xl",
        "data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out",
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton ? (
        <DialogPrimitive.Close asChild>
          <Button
            iconOnly
            variant="transparent"
            size="small"
            aria-label="Close"
            className="absolute right-2 top-2"
          >
            <X />
          </Button>
        </DialogPrimitive.Close>
      ) : null}
    </DialogPrimitive.Content>
  );
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay className={overlayClassName} />
      {content}
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-1 border-b border-separator px-4 py-3", className)}
      {...props}
    />
  );
}

export function DialogTitle({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title> & {
  variant?: "heading1" | "heading2";
}) {
  return (
    <DialogPrimitive.Title
      className={cn(
        variant === "heading2" ? "text-heading2" : "text-large",
        "font-semibold text-primary",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-small text-secondary", className)}
      {...props}
    />
  );
}

export interface DialogBodyProps extends React.ComponentProps<"div"> {
  maxHeight?: string;
  scrollAreaClassName?: string;
}

export function DialogBody({
  maxHeight = "60vh",
  scrollAreaClassName,
  className,
  children,
  ...props
}: DialogBodyProps) {
  return (
    <ScrollArea
      fadeEdges
      className={cn(scrollAreaClassName)}
      style={{ maxHeight }}
      viewportClassName="px-4 py-3"
    >
      <div className={cn("space-y-3", className)} {...props}>
        {children}
      </div>
    </ScrollArea>
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-2 border-t border-separator px-4 py-3", className)}
      {...props}
    />
  );
}
