import type { ReactNode } from "react";
import { Text } from "@glaze/core/components";
import { cn } from "@glaze/core/utils";
import type { SourceId } from "@main/shared-types";

import { COLOR_CLASS, SOURCE_META, useSourceColor } from "../lib/sources";

export function SourceDot({
  source,
  hollow,
  className,
}: {
  source: SourceId;
  hollow?: boolean;
  className?: string;
}) {
  const color = COLOR_CLASS[useSourceColor(source)];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        hollow ? cn("border-[1.5px]", color.border) : color.bg,
        className,
      )}
    />
  );
}

/** Small “● Source · detail” line used under row titles in mixed-source lists. */
export function SourceLabel({ source, detail }: { source: SourceId; detail?: string | null }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <SourceDot source={source} />
      <Text variant="small" color="tertiary" truncate>
        {[SOURCE_META[source].label, detail].filter(Boolean).join(" · ")}
      </Text>
    </span>
  );
}

/** Section or toolbar title prefixed with the source's color dot. */
export function SourceHeading({ source, children }: { source: SourceId; children?: ReactNode }) {
  return (
    <span className="flex items-center gap-2 min-w-0">
      <SourceDot source={source} className="size-2.5" />
      <span className="truncate">{children ?? SOURCE_META[source].label}</span>
    </span>
  );
}
