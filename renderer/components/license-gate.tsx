import type { ReactNode } from "react";

import { Button, EmptyState } from "../ui";
import { isLicenseBlocking, useLicenseStatus, type LicenseStatus } from "../lib/license";
import { openExternal, openSettings } from "../lib/ipc";

/** True once license data has loaded and the current state blocks AI actions. */
export function useLicenseGate(): {
  blocked: boolean;
  status: LicenseStatus | undefined;
  checkoutUrl: string;
  loading: boolean;
  error: boolean;
  retry: () => void;
} {
  const { data, isPending, isError, refetch } = useLicenseStatus();
  return {
    blocked: !data || isError || isLicenseBlocking(data.status),
    status: data?.status,
    checkoutUrl: data?.checkoutUrl ?? "",
    loading: isPending,
    error: isError,
    retry: () => {
      void refetch();
    },
  };
}

function upsellCopy(status: LicenseStatus): {
  title: string;
  description: string;
} {
  switch (status.state) {
    case "expired":
      return {
        title: "AI trial ended",
        description:
          "Everything else in DayBoard stays free. Get DayBoard Pro for $5, once, to keep using AI.",
      };
    case "invalid":
      // The reason varies (revoked, released by another account on this Mac, not verified yet).
      return {
        title: "License key needs attention",
        description: `${status.message} Open Settings → License to enter your key again or get DayBoard Pro.`,
      };
    case "network-error":
      return {
        title: "Can't verify your license",
        description:
          "The DayBoard license service hasn't been reachable for a while. Check your connection, then open Settings → License.",
      };
    case "unreadable":
      return {
        title: "Can't read license data",
        description:
          "DayBoard can't read the license data saved on this Mac. Open Settings → License to retry, enter your license key again, or reset license data on this Mac.",
      };
    default:
      return {
        title: "License required",
        description: "Open Settings → License to continue.",
      };
  }
}

/**
 * Wraps an AI surface: renders `children` when the license allows it, otherwise a "get Pro or
 * enter a key" prompt. Only AI is paid; every other view and action stays outside this gate.
 */
export function LicenseGate({
  children,
  placement = "inline",
}: {
  children: ReactNode;
  placement?: "inline" | "center" | "viewport";
}) {
  const { blocked, status, checkoutUrl, loading, error, retry } = useLicenseGate();
  if (!blocked) return <>{children}</>;
  if (loading || error || !status)
    return (
      <EmptyState
        placement={placement}
        title={error ? "License status unavailable" : "Checking license…"}
        description={
          error
            ? "DayBoard could not read your license status. Your saved data remains available."
            : undefined
        }
        actions={error ? <Button onClick={retry}>Retry</Button> : undefined}
      />
    );

  const copy = upsellCopy(status);
  return (
    <EmptyState
      placement={placement}
      title={copy.title}
      description={copy.description}
      actions={<LicenseUpsellActions checkoutUrl={checkoutUrl} />}
    />
  );
}

/** The buy and License buttons of every AI upsell. */
export function LicenseUpsellActions({
  checkoutUrl,
  size,
}: {
  checkoutUrl: string;
  size?: "small";
}) {
  return (
    <>
      {checkoutUrl ? (
        <Button variant="accent" size={size} onClick={() => void openExternal(checkoutUrl)}>
          Get DayBoard Pro · $5
        </Button>
      ) : null}
      <Button size={size} onClick={() => void openSettings("license")}>
        Open License Settings
      </Button>
    </>
  );
}

/** For call sites that want to keep their own layout and just disable a control instead of swapping it out. */
export function useLicenseGateAction(action: () => void): {
  run: () => void;
  blocked: boolean;
  disabledReason: string | undefined;
} {
  const { blocked, status } = useLicenseGate();
  return {
    run: () => {
      if (blocked) {
        void openSettings("license");
        return;
      }
      action();
    },
    blocked,
    disabledReason: blocked && status ? upsellCopy(status).description : undefined,
  };
}

export function LicenseStatusControl() {
  const { data, isError } = useLicenseStatus();
  if (
    !isError &&
    (!data ||
      data.status.state === "demo" ||
      data.status.state === "licensed" ||
      data.status.state === "disabled")
  )
    return null;
  const label = isError
    ? "License unavailable"
    : data?.status.state === "trial"
      ? `${data.status.daysLeft} day${data.status.daysLeft === 1 ? "" : "s"} left in your AI trial`
      : data?.status.state === "unconfigured"
        ? "Preview build"
        : data?.status.state === "unreadable"
          ? "License data needs attention"
          : "Unlock AI · DayBoard Pro";
  return (
    <Button
      size="small"
      variant="transparent"
      className="w-full justify-start"
      onClick={() => void openSettings("license")}
    >
      {label}
    </Button>
  );
}
