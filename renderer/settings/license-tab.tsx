import { useState } from "react";

import { Button, Callout, Field, FieldSet, Input, Status } from "../ui";
import {
  LICENSE_STATUS_COPY,
  useActivateLicense,
  useDeactivateLicense,
  useLicenseStatus,
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
          {canBuy ? (
            <Field>
              <Button variant="accent" onClick={() => openExternal(checkoutUrl)}>
                Buy DayBoard
              </Button>
            </Field>
          ) : null}
        </>
      )}
    </FieldSet>
  );
}
