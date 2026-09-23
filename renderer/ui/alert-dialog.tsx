import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "./utils";
import { Button, type ButtonProps } from "./button";
import { ScrollArea } from "./scroll-area";

const SIZE_CLASS = {
  small: "w-[min(90vw,20rem)]",
  medium: "w-[min(90vw,28rem)]",
  large: "w-[min(90vw,36rem)]",
  xl: "w-[min(90vw,44rem)]",
  "2xl": "w-[min(90vw,56rem)]",
} as const;

type AlertDialogSize = keyof typeof SIZE_CLASS;

export interface AlertDialogProps extends React.ComponentProps<typeof AlertDialogPrimitive.Root> {
  trigger?: React.ReactNode;
  title?: React.ReactNode;
  hideTitle?: boolean;
  description?: React.ReactNode;
  hideDescription?: boolean;
  onConfirm?: () => void | Promise<void>;
  confirmLabel?: React.ReactNode;
  confirmVariant?: "accent" | "destructive";
  confirmDisabled?: boolean;
  size?: AlertDialogSize;
  children?: React.ReactNode;
}

export function AlertDialog({
  trigger,
  title,
  hideTitle,
  description,
  hideDescription,
  onConfirm,
  confirmLabel = "Confirm",
  confirmVariant = "accent",
  confirmDisabled,
  size = "small",
  children,
  ...rootProps
}: AlertDialogProps) {
  const propsMode =
    onConfirm !== undefined &&
    (title !== undefined || trigger !== undefined || description !== undefined);
  const [pending, setPending] = React.useState(false);

  if (!propsMode) {
    return <AlertDialogPrimitive.Root {...rootProps}>{children}</AlertDialogPrimitive.Root>;
  }

  return (
    <AlertDialogPrimitive.Root {...rootProps}>
      {trigger ? (
        <AlertDialogPrimitive.Trigger asChild>{trigger}</AlertDialogPrimitive.Trigger>
      ) : null}
      <AlertDialogContent size={size}>
        <AlertDialogHeader>
          <AlertDialogTitle className={cn(hideTitle && "sr-only")}>{title}</AlertDialogTitle>
          {description ? (
            <AlertDialogDescription className={cn(hideDescription && "sr-only")}>
              {description}
            </AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        {children ? <AlertDialogBody>{children}</AlertDialogBody> : null}
        <AlertDialogFooter>
          <AlertDialogCancel />
          <AlertDialogAction
            variant={confirmVariant}
            disabled={confirmDisabled || pending}
            onClick={async () => {
              setPending(true);
              try {
                await onConfirm?.();
              } finally {
                setPending(false);
              }
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogPrimitive.Root>
  );
}

export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  size = "small",
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: AlertDialogSize;
}) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30" />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] -translate-x-1/2 -translate-y-1/2 flex-col gap-3",
          "rounded-xl border border-separator bg-background p-4 shadow-2xl",
          SIZE_CLASS[size],
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("text-large font-semibold text-primary", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-small text-secondary", className)}
      {...props}
    />
  );
}

export function AlertDialogBody({ className, ...props }: React.ComponentProps<typeof ScrollArea>) {
  return <ScrollArea fadeEdges className={cn("max-h-[50vh]", className)} {...props} />;
}

export function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2", className)} {...props} />;
}

export const AlertDialogAction = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ asChild, className, variant = "accent", children, ...props }, ref) => {
    if (asChild) {
      return (
        <AlertDialogPrimitive.Action asChild {...props}>
          {children}
        </AlertDialogPrimitive.Action>
      );
    }
    return (
      <AlertDialogPrimitive.Action asChild>
        <Button ref={ref} variant={variant} className={cn("flex-1", className)} {...props}>
          {children}
        </Button>
      </AlertDialogPrimitive.Action>
    );
  },
);
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = React.forwardRef<HTMLButtonElement, Partial<ButtonProps>>(
  ({ asChild, className, variant = "filled", children = "Cancel", ...props }, ref) => {
    if (asChild) {
      return (
        <AlertDialogPrimitive.Cancel asChild {...props}>
          {children}
        </AlertDialogPrimitive.Cancel>
      );
    }
    return (
      <AlertDialogPrimitive.Cancel asChild>
        <Button ref={ref} variant={variant} className={cn("flex-1", className)} {...props}>
          {children}
        </Button>
      </AlertDialogPrimitive.Cancel>
    );
  },
);
AlertDialogCancel.displayName = "AlertDialogCancel";
