import { useNavigate } from "@tanstack/react-router";
import { Button, Text } from "@glaze/core/components";
import { ChevronRight } from "lucide-react";
import type { SourceId } from "@main/shared-types";

import { SOURCE_META } from "../lib/sources";
import { SourceDot } from "./source-dot";

export function SourceTile({
  source,
  value,
  caption,
}: {
  source: SourceId;
  value: number | null;
  caption: string;
}) {
  const navigate = useNavigate();
  const meta = SOURCE_META[source];

  return (
    <div className="rounded-xl bg-well pl-3.5 pr-1.5 py-2.5 flex flex-col gap-1 min-w-0">
      <div className="flex items-center gap-2 min-w-0">
        <SourceDot source={source} className="size-2.5" />
        <Text variant="small-strong" color="secondary" truncate className="flex-1 min-w-0">
          {meta.label}
        </Text>
        <Button
          size="small"
          variant="transparent"
          iconOnly
          aria-label={`Open ${meta.label}`}
          title={`Open ${meta.label}`}
          onClick={() => void navigate({ to: meta.route })}
        >
          <ChevronRight />
        </Button>
      </div>
      <Text variant="heading1" as="p" className="tabular-nums">
        {value === null ? "–" : value}
      </Text>
      <Text variant="small" color="tertiary" truncate className="pr-2">
        {caption}
      </Text>
    </div>
  );
}
