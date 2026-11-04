import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Button, Dialog, Input, Status, Text, toast } from "@renderer/ui";
import { cn } from "@renderer/ui/utils";

import { formatMailDate } from "../lib/dates";
import { errorMessage, invoke, openExternal } from "../lib/ipc";

interface Subscription {
  name: string;
  email: string;
  count: number;
  opened: number;
  lastAt: number;
  unsubscribe: { oneClick?: string; mailto?: string; url?: string };
}

interface SubscriptionList {
  scannedAt: number;
  subscriptions: Subscription[];
}

type UnsubscribeResult = { method: "one-click" | "email" } | { method: "browser"; url: string };

const subscriptionsKey = ["mail-subscriptions"] as const;

const SubscriptionsContext = createContext<() => void>(() => {});

export function useOpenSubscriptions() {
  return useContext(SubscriptionsContext);
}

export function SubscriptionsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <SubscriptionsContext.Provider value={() => setOpen(true)}>
      {children}
      {open ? <SubscriptionsDialog onClose={() => setOpen(false)} /> : null}
    </SubscriptionsContext.Provider>
  );
}

function openedLabel(item: Subscription): string {
  return `${item.opened} of ${item.count} opened`;
}

function SubscriptionsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const list = useQuery({
    queryKey: subscriptionsKey,
    queryFn: () => invoke<SubscriptionList>("mail:subscriptions"),
    staleTime: Infinity,
  });
  const refresh = useMutation({
    mutationFn: () => invoke<SubscriptionList>("mail:subscriptions", { refresh: true }),
    onSuccess: (data) => queryClient.setQueryData(subscriptionsKey, data),
    onError: (error) => toast.error(`Couldn't scan your mail: ${errorMessage(error)}`),
  });
  const unsubscribe = useMutation({
    mutationFn: (item: Subscription) =>
      invoke<UnsubscribeResult>("mail:unsubscribe", { email: item.email }),
    onSuccess: (result, item) => {
      if (result.method === "browser") {
        void openExternal(result.url);
        toast(`Finish unsubscribing from ${item.name} in your browser`);
        return;
      }
      queryClient.setQueryData<SubscriptionList>(subscriptionsKey, (previous) =>
        previous
          ? {
              ...previous,
              subscriptions: previous.subscriptions.filter((entry) => entry.email !== item.email),
            }
          : previous,
      );
      toast.success(
        result.method === "email"
          ? `Asked ${item.name} to unsubscribe you by email`
          : `Unsubscribed from ${item.name}`,
      );
    },
    onError: (error, item) =>
      toast.error(`Couldn't unsubscribe from ${item.name}: ${errorMessage(error)}`),
  });

  const query = filter.trim().toLowerCase();
  const items = (list.data?.subscriptions ?? []).filter(
    (item) => !query || item.name.toLowerCase().includes(query) || item.email.includes(query),
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title="Subscriptions"
      description="Newsletters and lists that wrote to you in the last 90 days, most mail first."
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Search subscriptions"
            className="flex-1"
            placeholder="Search senders"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Button
            size="small"
            disabled={list.isPending || refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            Refresh
          </Button>
        </div>
        {list.isPending || refresh.isPending ? (
          <Status variant="loading">Scanning the last 90 days of mail…</Status>
        ) : list.isError ? (
          <Text color="red" role="alert">
            {errorMessage(list.error)}
          </Text>
        ) : items.length ? (
          <ul aria-label="Senders" className="divide-y divide-separator rounded-xl bg-well">
            {items.map((item) => (
              <li key={item.email} className="flex min-w-0 items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <Text variant="strong" truncate>
                    {item.name}
                  </Text>
                  <Text variant="small" color="secondary" truncate>
                    {item.email} · last {formatMailDate(new Date(item.lastAt).toISOString())}
                  </Text>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-control px-2 py-0.5 text-small text-secondary tabular-nums",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      item.opened === 0 ? "bg-support-orange" : "bg-support-green",
                    )}
                  />
                  {openedLabel(item)}
                </span>
                <Button
                  size="small"
                  aria-label={`Unsubscribe from ${item.name}`}
                  disabled={unsubscribe.isPending}
                  onClick={() => unsubscribe.mutate(item)}
                >
                  {item.unsubscribe.oneClick || item.unsubscribe.mailto
                    ? "Unsubscribe"
                    : "Open page"}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <Text color="tertiary">
            {query ? "No senders match." : "No newsletters or lists in the last 90 days."}
          </Text>
        )}
        {list.data ? (
          <Text variant="small" color="tertiary">
            Scanned {formatMailDate(new Date(list.data.scannedAt).toISOString())}. Senders you
            rarely open are worth a look.
          </Text>
        ) : null}
      </div>
    </Dialog>
  );
}
