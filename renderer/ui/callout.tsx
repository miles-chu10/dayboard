import * as React from "react";
import { X } from "lucide-react";

import { cn } from "./utils";

export type CalloutColor =
  | "primary"
  | "secondary"
  | "blue"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple"
  | "magenta";

const COLOR_CLASS: Record<CalloutColor, string> = {
  primary: "bg-primary/10 text-primary",
  secondary: "bg-control text-secondary",
  blue: "bg-support-blue-10 text-support-blue",
  green: "bg-support-green-10 text-support-green",
  yellow: "bg-support-yellow-10 text-support-yellow",
  orange: "bg-support-orange-10 text-support-orange",
  red: "bg-support-red-10 text-support-red",
  purple: "bg-support-purple-10 text-support-purple",
  magenta: "bg-support-magenta-10 text-support-magenta",
};

export interface CalloutProps extends Omit<React.ComponentProps<"div">, "color"> {
  color?: CalloutColor;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
}

function CalloutRoot({
  color = "secondary",
  icon,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  className,
  children,
  ...props
}: CalloutProps) {
  const structured = icon !== undefined || actions !== undefined || onDismiss !== undefined;
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-small",
        COLOR_CLASS[color],
        !structured && "justify-center text-center",
        className,
      )}
      {...props}
    >
      {structured ? (
        <>
          {icon ? <CalloutIcon>{icon}</CalloutIcon> : null}
          <CalloutText>{children}</CalloutText>
          {actions ? <CalloutActions>{actions}</CalloutActions> : null}
          {onDismiss ? <CalloutClose label={dismissLabel} onClick={onDismiss} /> : null}
        </>
      ) : (
        children
      )}
    </div>
  );
}

function CalloutIcon({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex shrink-0 items-center [&>svg]:size-4", className)} {...props}>
      {children}
    </div>
  );
}

function CalloutText({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("min-w-0 flex-1", className)} {...props} />;
}

function CalloutActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex shrink-0 items-center gap-2", className)} {...props} />;
}

function CalloutClose({
  label = "Dismiss",
  className,
  "aria-label": ariaLabel,
  ...props
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? label}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full text-current opacity-70 hover:opacity-100",
        className,
      )}
      {...props}
    >
      <X className="size-3.5" />
    </button>
  );
}

export const Callout = Object.assign(CalloutRoot, {
  Icon: CalloutIcon,
  Text: CalloutText,
  Actions: CalloutActions,
  Close: CalloutClose,
});
