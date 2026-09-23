import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "../ui";
import { errorMessage } from "./ipc";
import type { LicenseStatus, LicenseStatusPayload } from "@shared/license";
export type { LicenseStatus, LicenseStatusPayload } from "@shared/license";

export function isLicenseBlocking(status: LicenseStatus): boolean {
  return (
    status.state === "expired" || status.state === "invalid" || status.state === "network-error"
  );
}

export const LICENSE_STATUS_COPY: Record<
  LicenseStatus["state"],
  { label: string; description: string }
> = {
  demo: {
    label: "Demo",
    description: "This preview uses fictional data. Purchases are unavailable in demo mode.",
  },
  unconfigured: {
    label: "Preview build",
    description:
      "Purchases are not available in this build yet. You can continue using the preview.",
  },
  disabled: {
    label: "Community build",
    description: "This build does not require a purchase.",
  },
  trial: { label: "Trial", description: "Your free trial is active." },
  expired: {
    label: "Trial expired",
    description:
      "Your trial has ended. Your data remains available; activate a license to edit connected sources and use AI.",
  },
  invalid: {
    label: "Invalid key",
    description: "This license key isn't valid. Check it or buy a new one.",
  },
  licensed: {
    label: "Licensed",
    description: "Thanks for supporting DayBoard.",
  },
  "network-error": {
    label: "Can't verify",
    description: "DayBoard couldn't reach its license service. Check your connection.",
  },
};

function license(channel: string, ...args: unknown[]): Promise<LicenseStatusPayload> {
  return window.dayboard.ipc.invoke<LicenseStatusPayload>(channel, ...args);
}

export const licenseQueryKey = ["license"] as const;

export function useLicenseStatus() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: licenseQueryKey,
    // `license:refresh` respects the daily revalidation cap internally, so calling it on every
    // mount (once per app launch, in practice) is how the license silently stays revalidated.
    queryFn: () => license("license:refresh"),
    staleTime: 5 * 60_000,
  });

  useEffect(
    () =>
      window.dayboard.ipc.onNotification("license:changed", (params) => {
        queryClient.setQueryData(licenseQueryKey, params as LicenseStatusPayload);
      }),
    [queryClient],
  );

  return query;
}

export function useActivateLicense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (licenseKey: string) => license("license:activate", licenseKey),
    onSuccess: (payload) => queryClient.setQueryData(licenseQueryKey, payload),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useDeactivateLicense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => license("license:deactivate"),
    onSuccess: (payload) => {
      queryClient.setQueryData(licenseQueryKey, payload);
      toast.success("License key removed from this device.");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}
