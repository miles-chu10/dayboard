import type { UseQueryResult } from "@tanstack/react-query";
import {
  Button,
  Callout,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleRoot,
  CollapsibleTrigger,
  Text,
} from "@glaze/core/components";
import type { SourceId, SourceResult } from "@main/shared-types";

import { formatTimeOfDay } from "../lib/dates";
import { openSettings } from "../lib/ipc";
import { SOURCE_META } from "../lib/sources";
import { sourceStatusShort } from "./source-gate";
import { SourceDot } from "./source-dot";

export function AgendaSourceStatus({
  sources,
  refreshMinutes,
}: {
  sources: { source: SourceId; query: UseQueryResult<SourceResult<unknown>> }[];
  refreshMinutes: number;
}) {
  const issues = sources.filter(
    ({ query }) =>
      query.isError ||
      (query.data &&
        (query.data.state !== "ok" ||
          query.data.refreshError ||
          query.data.coverage?.complete === false)),
  );
  return (
    <CollapsibleRoot>
      <CollapsibleTrigger variant="section" aria-label="Source sync status">
        <CollapsibleChevron />
        {issues.length
          ? `${issues.length} source${issues.length === 1 ? " needs" : "s need"} attention`
          : sources.some(({ query }) => query.isFetching)
            ? "Refreshing sources…"
            : "Source status"}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 pt-2">
          {sources.map(({ source, query }) => {
            const data = query.data;
            const ok = data?.state === "ok" ? data : null;
            const issue =
              query.isError || Boolean(ok?.refreshError) || ok?.coverage?.complete === false;
            return (
              <div key={source} className="flex flex-wrap items-center gap-2 px-1">
                <SourceDot source={source} />
                <Text variant="small">{SOURCE_META[source].label}</Text>
                <Text variant="small" color={issue ? "orange" : "secondary"}>
                  {query.isPending
                    ? "Loading…"
                    : query.isError
                      ? "Unavailable"
                      : ok
                        ? `${ok.items.length} loaded${ok.coverage?.complete === false ? " · partial" : ""}${ok.refreshError ? " · refresh failed; showing saved results" : ""}${ok.refreshedAt ? ` · updated ${formatTimeOfDay(ok.refreshedAt)}` : ""}`
                        : sourceStatusShort(data)}
                </Text>
                {issue ? (
                  <Button
                    size="small"
                    onClick={() => void query.refetch()}
                    disabled={query.isFetching}
                  >
                    Retry
                  </Button>
                ) : !ok && !query.isPending ? (
                  <Button size="small" onClick={() => void openSettings()}>
                    Settings
                  </Button>
                ) : null}
              </div>
            );
          })}
          <Text variant="small" color="tertiary">
            {refreshMinutes
              ? `Checks every ${refreshMinutes} minutes while active.`
              : "Automatic refresh is off."}{" "}
            Refresh is also available in the toolbar.
          </Text>
        </div>
      </CollapsibleContent>
      {issues.length ? (
        <Callout color="orange">
          Some sources are unavailable or incomplete. Available items remain visible.
        </Callout>
      ) : null}
    </CollapsibleRoot>
  );
}
