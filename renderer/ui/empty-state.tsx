import * as React from "react";

import { cn } from "./utils";
import { Text } from "./text";

const PLACEMENT_CLASS = {
  center: "h-full items-center justify-center text-center",
  inline: "items-start text-left",
  viewport: "min-h-[60vh] items-center justify-center text-center",
} as const;

export interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  media?: React.ReactNode;
  placement?: keyof typeof PLACEMENT_CLASS;
}

export function EmptyState({
  title,
  description,
  actions,
  media,
  placement = "center",
  className,
  children,
  ...props
}: EmptyStateProps) {
  const propsMode =
    title !== undefined ||
    description !== undefined ||
    actions !== undefined ||
    media !== undefined;
  return (
    <div
      className={cn("flex flex-col gap-2 px-6 py-8", PLACEMENT_CLASS[placement], className)}
      {...props}
    >
      {propsMode ? (
        <>
          {media ? <EmptyStateMedia>{media}</EmptyStateMedia> : null}
          {title ? <EmptyStateTitle>{title}</EmptyStateTitle> : null}
          {description ? <EmptyStateDescription>{description}</EmptyStateDescription> : null}
          {actions ? <EmptyStateActions>{actions}</EmptyStateActions> : null}
        </>
      ) : (
        children
      )}
    </div>
  );
}

export function EmptyStateMedia({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-1 flex items-center justify-center", className)} {...props} />;
}

export function EmptyStateTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text as="h1" variant="heading1" className={cn("font-normal", className)} {...props} />;
}

export function EmptyStateDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text as="p" color="tertiary" className={cn("max-w-sm", className)} {...props} />;
}

export function EmptyStateActions({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mt-1 flex flex-col items-center gap-2", className)} {...props} />;
}
