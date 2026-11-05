import { useState } from "react";

import { AlertDialog, Button, Callout, Field, FieldSet, Input, Status } from "../ui";
import {
  LICENSE_FORGET_COPY,
  LICENSE_RELEASE_PENDING_COPY,
  LICENSE_RESET_COPY,
  LICENSE_STATUS_COPY,
  useActivateLicense,
  useDeactivateLicense,
  useForgetPendingRelease,
  useLicenseStatus,
  useResetLicenseData,
} from "../lib/license";
import { openExternal } from "../lib/ipc";

const STATUS_VARIANT = {
  demo: "neutral",
  unconfigured: "neutral",
  disabled: "neutral",
  trial: "neutral",
  expired: "warning",
  invalid: "warning",
  licensed: "success",
  "network-error": "warning",
  unreadable: "warning",
} as const;

function KeyEntry({ busy, onSubmit }: { busy: boolean; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState("");
  const commit = () => {
    const trimmed = key.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <Field label="License key">
      <div className="flex gap-2">
        <Input
          aria-label="License key"
          placeholder="Paste your license key"
          value={key}
          disabled={busy}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) commit();
          }}
          className="flex-1"
        />
        <Button variant="accent" onClick={commit} disabled={busy || !key.trim()}>
          {busy ? "Activating…" : "Activate"}
        </Button>
      </div>
    </Field>
  );
}

export function LicenseTab() {
  const { data, isLoading, isError, refetch } = useLicenseStatus();
  const activate = useActivateLicense();
  const deactivate = useDeactivateLicense();
  const reset = useResetLicenseData();
  const forget = useForgetPendingRelease();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingForget, setConfirmingForget] = useState(false);

  if (isError)
    return (
      <FieldSet title="License">
        <Callout color="orange">
          DayBoard could not read your license status. Your saved data remains available.
        </Callout>
        <Button onClick={() => void refetch()}>Retry</Button>
      </FieldSet>
    );
  if (isLoading || !data) {
    return (
      <FieldSet title="License">
        <Field label="Status">
          <Status variant="loading">Checking…</Status>
        </Field>
      </FieldSet>
    );
  }

  const { status, checkoutUrl } = data;
  const copy = LICENSE_STATUS_COPY[status.state];
  const canBuy = checkoutUrl.trim().length > 0;
  // From the saved record, so it survives reopening Settings and clears once a retry confirms.
  // Only while no key is saved, so "Try again" can never remove a newly entered key.
  const releasePending =
    data.releasePending === true && (status.state === "trial" || status.state === "expired");
  const releaseBusy = deactivate.isPending || forget.isPending;

  return (
    <FieldSet title="License" description={copy.description}>
      <Field label="Status">
        <Status variant={STATUS_VARIANT[status.state]}>
          {status.state === "trial"
            ? `${copy.label} — ${status.daysLeft} day${status.daysLeft === 1 ? "" : "s"} left`
            : status.state === "licensed" ||
                status.state === "invalid" ||
                status.state === "network-error"
              ? `${copy.label} — key ending in ${status.keyHint}`
              : copy.label}
        </Status>
      </Field>

      {status.state === "invalid" ? (
        <Field>
          <Callout color="orange">{status.message}</Callout>
        </Field>
      ) : null}

      {releasePending ? (
        <Field>
          <Callout
            color="orange"
            actions={
              <>
                <Button size="small" onClick={() => deactivate.mutate()} disabled={releaseBusy}>
                  {deactivate.isPending ? "Trying…" : LICENSE_RELEASE_PENDING_COPY.retry}
                </Button>
                <Button
                  size="small"
                  variant="transparent"
                  onClick={() => setConfirmingForget(true)}
                  disabled={releaseBusy}
                >
                  {LICENSE_FORGET_COPY.action}
                </Button>
              </>
            }
          >
            {LICENSE_RELEASE_PENDING_COPY.callout}
          </Callout>
        </Field>
      ) : null}

      {status.state === "disabled" ||
      status.state === "demo" ||
      status.state === "unconfigured" ? null : status.state === "licensed" ? (
        <Field>
          <Button onClick={() => deactivate.mutate()} disabled={deactivate.isPending}>
            {deactivate.isPending ? "Removing…" : "Deactivate this device"}
          </Button>
        </Field>
      ) : (
        <>
          <Field>
            <p className="text-small text-secondary">
              After checkout, copy your license key from the DayBoard receipt page and activate it
              here.
            </p>
          </Field>
          <KeyEntry busy={activate.isPending} onSubmit={(key) => activate.mutate(key)} />
          {status.state === "network-error" || status.state === "invalid" ? (
            <Field>
              <Button onClick={() => deactivate.mutate()} disabled={deactivate.isPending}>
                {deactivate.isPending ? "Removing…" : "Remove saved key"}
              </Button>
            </Field>
          ) : null}
          {status.state === "unreadable" ? (
            <Field>
              <div className="flex gap-2">
                <Button onClick={() => void refetch()}>Retry</Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmingReset(true)}
                  disabled={reset.isPending}
                >
                  {reset.isPending ? "Resetting…" : LICENSE_RESET_COPY.action}
                </Button>
              </div>
            </Field>
          ) : null}
          {canBuy ? (
            <Field>
              <Button variant="accent" onClick={() => openExternal(checkoutUrl)}>
                Get DayBoard Pro · $5
              </Button>
            </Field>
          ) : null}
        </>
      )}

      <AlertDialog
        open={confirmingReset}
        onOpenChange={setConfirmingReset}
        title={LICENSE_RESET_COPY.title}
        description={LICENSE_RESET_COPY.description}
        confirmLabel={LICENSE_RESET_COPY.confirm}
        confirmVariant="destructive"
        onConfirm={() => reset.mutate()}
      />
      <AlertDialog
        open={confirmingForget}
        onOpenChange={setConfirmingForget}
        title={LICENSE_FORGET_COPY.title}
        description={LICENSE_FORGET_COPY.description}
        confirmLabel={LICENSE_FORGET_COPY.confirm}
        confirmVariant="destructive"
        onConfirm={() => forget.mutate()}
      />
    </FieldSet>
  );
}
