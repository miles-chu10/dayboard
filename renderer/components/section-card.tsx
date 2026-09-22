import type { ReactNode } from "react";
import { Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";

export function SectionCard({
  title,
  accessory,
  children,
  className,
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2 min-w-0", className)}>
      <div className="flex items-center gap-2 min-h-8 px-1">
        <Text variant="large-strong" as="h2" truncate className="flex-1 min-w-0">
          {title}
        </Text>
        {accessory ? <div className="flex items-center gap-2 shrink-0">{accessory}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function ListCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-well divide-y divide-separator overflow-hidden">{children}</div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-xl bg-well divide-y divide-separator overflow-hidden" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 px-3 flex items-center gap-3">
          <div className="size-4 rounded bg-control-subtle animate-pulse shrink-0" />
          <div className="h-3 w-1/2 rounded bg-control-subtle animate-pulse" />
        </div>
      ))}
    </div>
  );
}

export function InlineHint({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl bg-well px-4 py-3">
      <Text color="tertiary">{children}</Text>
    </div>
  );
}
