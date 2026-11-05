import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = await mkdtemp(path.join(tmpdir(), "dayboard-license-ui-"));
await symlink(path.join(root, "node_modules"), path.join(tempDir, "node_modules"));

const fixture = {
  query: {},
  buttons: [],
  dialogs: [],
  calls: [],
  retries: 0,
  // Mutations started by a click, the IPC calls they made and the toasts they showed.
  runs: [],
  invocations: [],
  toasts: [],
};
globalThis.__dayboardLicenseUiFixture = fixture;

const uiModule = `
  import React from "react";
  import { Button as RealButton } from ${JSON.stringify(path.join(root, "renderer/ui/button.tsx"))};
  import { AlertDialog as RealAlertDialog } from ${JSON.stringify(path.join(root, "renderer/ui/alert-dialog.tsx"))};
  export { EmptyState } from ${JSON.stringify(path.join(root, "renderer/ui/empty-state.tsx"))};
  export { Callout } from ${JSON.stringify(path.join(root, "renderer/ui/callout.tsx"))};
  export { Field, FieldSet } from ${JSON.stringify(path.join(root, "renderer/ui/field.tsx"))};
  export { Input } from ${JSON.stringify(path.join(root, "renderer/ui/input.tsx"))};
  export { Status } from ${JSON.stringify(path.join(root, "renderer/ui/status.tsx"))};
  const fixture = () => globalThis.__dayboardLicenseUiFixture;
  export function Button(props) {
    fixture().buttons.push({ label: props.children, onClick: props.onClick });
    return React.createElement(RealButton, props);
  }
  export function AlertDialog(props) {
    fixture().dialogs.push({ title: props.title, open: props.open, onConfirm: props.onConfirm });
    return React.createElement(RealAlertDialog, props);
  }
  const record = (kind) => (message) => fixture().toasts.push([kind, message]);
  export const toast = { error: record("error"), success: record("success"), warning: record("warning") };
`;

const fixturePlugin = {
  name: "license-ui-boundaries",
  setup(api) {
    api.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({
      path: "react-query",
      namespace: "license-ui-fixture",
    }));
    api.onResolve({ filter: /^(\.\.\/ui|\.\.\/lib\/ipc|\.\/ipc)$/ }, (args) => ({
      path: args.path === "../ui" ? "ui" : "ipc",
      namespace: "license-ui-fixture",
    }));
    api.onLoad({ filter: /.*/, namespace: "license-ui-fixture" }, (args) => ({
      contents:
        args.path === "ui"
          ? uiModule
          : args.path === "ipc"
            ? `
              export function openSettings(tab) {
                globalThis.__dayboardLicenseUiFixture.calls.push(["settings", tab]);
              }
              export function openExternal(url) {
                globalThis.__dayboardLicenseUiFixture.calls.push(["external", url]);
              }
              export function errorMessage(error) { return String(error); }
            `
            : `
              const fixture = () => globalThis.__dayboardLicenseUiFixture;
              export function useQuery() { return fixture().query; }
              export function useQueryClient() { return { setQueryData() {} }; }
              // Runs the real mutationFn and onSuccess/onError, as React Query would.
              export function useMutation(options) {
                return {
                  isPending: false,
                  data: undefined,
                  mutate(variables) {
                    fixture().runs.push(
                      Promise.resolve()
                        .then(() => options.mutationFn(variables))
                        .then(
                          (data) => options.onSuccess?.(data, variables),
                          (error) => options.onError?.(error, variables),
                        ),
                    );
                  },
                };
              }
            `,
      resolveDir: root,
      loader: "js",
    }));
  },
};

let LicenseGate;
let LicenseStatusControl;
let LicenseTab;
try {
  await build({
    entryPoints: [
      path.join(root, "renderer/components/license-gate.tsx"),
      path.join(root, "renderer/settings/license-tab.tsx"),
    ],
    outdir: tempDir,
    entryNames: "[name]",
    outExtension: { ".js": ".mjs" },
    bundle: true,
    splitting: true,
    format: "esm",
    jsx: "automatic",
    platform: "node",
    packages: "external",
    plugins: [fixturePlugin],
    logLevel: "silent",
  });
  ({ LicenseGate, LicenseStatusControl } = await import(
    pathToFileURL(path.join(tempDir, "license-gate.mjs"))
  ));
  ({ LicenseTab } = await import(pathToFileURL(path.join(tempDir, "license-tab.mjs"))));
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

function render(Component, query) {
  fixture.query = {
    data: undefined,
    isPending: false,
    isLoading: false,
    isError: false,
    refetch: () => {
      fixture.retries++;
    },
    ...query,
  };
  fixture.buttons = [];
  fixture.dialogs = [];
  fixture.calls = [];
  fixture.retries = 0;
  fixture.runs = [];
  fixture.invocations = [];
  fixture.toasts = [];
  return renderToStaticMarkup(React.createElement(Component));
}

/** Runs `action` (a click or a dialog confirm) with `window.dayboard.ipc` answering `reply`. */
async function withIpc(reply, action) {
  globalThis.window = {
    dayboard: {
      ipc: {
        invoke: async (channel, ...args) => {
          fixture.invocations.push([channel, ...args]);
          return reply;
        },
      },
    },
  };
  try {
    action();
    await Promise.all(fixture.runs);
  } finally {
    delete globalThis.window;
  }
}

function dialog(title) {
  const found = fixture.dialogs.find((item) => item.title === title);
  assert.ok(found, `Expected a ${title} dialog`);
  assert.equal(found.open, false, `${title} starts closed`);
  return found;
}

function gate(query) {
  return render(() => React.createElement(LicenseGate, null, "PRIVATE ACTION CONTENT"), query);
}

function status(state, checkoutUrl = "https://example.invalid/checkout") {
  const details = {
    trial: { daysLeft: 5 },
    licensed: { keyHint: "1234" },
    invalid: { keyHint: "1234", message: "Key rejected" },
    "network-error": { keyHint: "1234", lastValidatedAt: "2026-09-01" },
  };
  return { data: { status: { state, ...details[state] }, checkoutUrl } };
}

function click(label) {
  const button = fixture.buttons.find((item) => item.label === label);
  assert.ok(button, `Expected a rendered ${label} button`);
  assert.equal(typeof button.onClick, "function");
  button.onClick();
}

test("gate withholds protected content while loading and on status lookup failure", () => {
  const loading = gate({ isPending: true, isLoading: true });
  assert.match(loading, /Checking license/);
  assert.doesNotMatch(loading, /PRIVATE ACTION CONTENT/);

  const error = gate({ isPending: false, isError: true });
  assert.match(error, /License status unavailable/);
  assert.match(error, /saved data remains available/);
  assert.doesNotMatch(error, /Checking license|PRIVATE ACTION CONTENT/);
  click("Retry");
  assert.equal(fixture.retries, 1);

  const staleLicensed = gate({ ...status("licensed"), isError: true });
  assert.match(staleLicensed, /License status unavailable/);
  assert.doesNotMatch(staleLicensed, /PRIVATE ACTION CONTENT/);
});

test("Settings shows a recoverable storage error instead of endless loading", () => {
  const loading = render(LicenseTab, { isLoading: true });
  assert.match(loading, /Checking/);
  assert.doesNotMatch(loading, /Retry|License key|Buy DayBoard/);

  const error = render(LicenseTab, { isError: true, isLoading: false });
  assert.match(error, /could not read your license status/);
  assert.match(error, />Retry</);
  assert.doesNotMatch(error, /Checking/);
  click("Retry");
  assert.equal(fixture.retries, 1);
});

test("gate renders intended content for trial, licensed, demo, and unconfigured statuses", () => {
  for (const state of ["trial", "licensed", "demo", "unconfigured"]) {
    const html = gate(status(state));
    assert.match(html, /PRIVATE ACTION CONTENT/, state);
    assert.doesNotMatch(html, /Buy DayBoard|Open License Settings/, state);
  }
});

test("gate blocks expired and invalid statuses and opens License Settings", () => {
  for (const state of ["expired", "invalid"]) {
    const html = gate(status(state));
    assert.doesNotMatch(html, /PRIVATE ACTION CONTENT/, state);
    assert.match(html, /Open License Settings/, state);
    click("Open License Settings");
    assert.deepEqual(fixture.calls, [["settings", "license"]], state);
  }
});

test("an invalid key shows the service's reason instead of a generic one", () => {
  const released = {
    data: {
      status: {
        state: "invalid",
        keyHint: "1234",
        message:
          "This Mac's activation was released. Enter your license key again to reactivate it.",
      },
      checkoutUrl: "https://example.invalid/checkout",
    },
  };
  for (const html of [gate(released), render(LicenseTab, released)]) {
    assert.match(html, /This Mac(&#x27;|')s activation was released/);
    assert.doesNotMatch(html, /isn(&#x27;|')t valid|no longer valid|not valid/);
  }
});

test("network error names the DayBoard license service and withholds protected content", () => {
  const html = gate(status("network-error"));
  assert.match(html, /DayBoard license service/);
  assert.doesNotMatch(html, /Lemon Squeezy|PRIVATE ACTION CONTENT/);
  assert.match(html, /Open License Settings/);
});

test("demo and unconfigured Settings never expose activation or checkout", () => {
  for (const state of ["demo", "unconfigured"]) {
    const html = render(LicenseTab, status(state));
    assert.match(html, state === "demo" ? /Demo/ : /Preview build/);
    assert.doesNotMatch(html, /License key|Activate|Buy DayBoard|Paste your license key/);
    assert.equal(fixture.buttons.length, 0, state);
  }
});

test("license status control opens the License tab when status needs attention", () => {
  const html = render(LicenseStatusControl, status("expired"));
  assert.match(html, /Unlock AI/);
  click("Unlock AI · DayBoard Pro");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);

  render(LicenseStatusControl, status("unreadable"));
  click("License data needs attention");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);
});

test("unreadable license data blocks AI and points to Settings", () => {
  const html = gate(status("unreadable"));
  assert.doesNotMatch(html, /PRIVATE ACTION CONTENT/);
  assert.match(html, /Can(&#x27;|')t read license data/);
  assert.match(html, /reset license data on this Mac/);
  click("Open License Settings");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);
});

test("Settings offers Retry, key entry and a confirmed reset for unreadable license data", () => {
  const html = render(LicenseTab, status("unreadable"));
  assert.match(html, /Can(&#x27;|')t read license data/);
  assert.match(html, /Keychain access/);
  assert.match(html, /Paste your license key/);
  assert.match(html, />Reset license data on this Mac</);
  assert.doesNotMatch(html, /Deactivate this device|Remove saved key/);
  // The reset itself waits for the confirmation dialog, which starts closed.
  assert.doesNotMatch(html, /Reset license data on this Mac\?/);
  click("Retry");
  assert.equal(fixture.retries, 1);

  for (const state of ["trial", "licensed", "invalid", "network-error"]) {
    assert.doesNotMatch(render(LicenseTab, status(state)), /Reset license data/, state);
  }
});

function pendingRelease(state, releasePending = true) {
  const query = status(state);
  return { data: { ...query.data, releasePending } };
}

test("a saved, unconfirmed release shows how to free the slot, only while no key is saved", () => {
  for (const state of ["trial", "expired"]) {
    const html = render(LicenseTab, pendingRelease(state));
    assert.match(
      html,
      /couldn(&#x27;|')t confirm with the license service that this Mac(&#x27;|')s/,
    );
    assert.match(html, /may still count toward the key(&#x27;|')s 3-Mac limit/, state);
    assert.match(html, /keeps the key encrypted on this Mac only until the license service/);
    assert.doesNotMatch(html, /couldn(&#x27;|')t reach/, state);
    assert.match(html, /support@getdayboard\.com/, state);
    assert.match(html, />Try again</, state);
    assert.match(html, />Forget without releasing</, state);
  }
  for (const state of ["licensed", "invalid", "network-error", "unreadable"]) {
    const html = render(LicenseTab, pendingRelease(state));
    assert.doesNotMatch(html, /3-Mac limit|>Try again<|Forget without releasing/, state);
  }
  // Once a retry confirms (or with nothing pending) the warning is gone.
  for (const query of [pendingRelease("trial", false), status("trial")]) {
    assert.doesNotMatch(render(LicenseTab, query), /3-Mac limit|Forget without releasing/);
  }
});

test("Try again retries the release; Forget without releasing asks first, then deletes the key", async () => {
  render(LicenseTab, pendingRelease("trial"));
  await withIpc(
    {
      status: { state: "trial", daysLeft: 5 },
      checkoutUrl: "",
      releasePending: false,
      release: "released",
    },
    () => click("Try again"),
  );
  assert.deepEqual(fixture.invocations, [["license:deactivate"]]);
  assert.deepEqual(fixture.toasts, [
    ["success", "Removed the license from this Mac. Its activation slot is free."],
  ]);

  render(LicenseTab, pendingRelease("trial"));
  const forget = dialog("Delete the key without freeing its slot?");
  await withIpc({ status: { state: "trial", daysLeft: 5 }, checkoutUrl: "" }, () =>
    forget.onConfirm(),
  );
  assert.deepEqual(fixture.invocations, [
    ["license:forget-release", "forget-license-key-without-releasing"],
  ]);
  assert.deepEqual(fixture.toasts, [
    [
      "success",
      "Deleted the license key from this Mac. Its activation slot may still be in use; email support@getdayboard.com to free it.",
    ],
  ]);
});

test("deactivation toasts say whether the activation slot was freed", async () => {
  for (const [release, toast] of [
    ["released", ["success", "Removed the license from this Mac. Its activation slot is free."]],
    ["none", ["success", "Removed the license key from this Mac."]],
    [
      "pending",
      [
        "warning",
        "DayBoard stopped using the license on this Mac, but couldn't confirm its activation slot is free.",
      ],
    ],
  ]) {
    for (const [state, label] of [
      ["licensed", "Deactivate this device"],
      ["invalid", "Remove saved key"],
    ]) {
      render(LicenseTab, status(state));
      await withIpc(
        {
          status: { state: "trial", daysLeft: 5 },
          checkoutUrl: "",
          releasePending: release === "pending",
          release,
        },
        () => click(label),
      );
      assert.deepEqual(fixture.invocations, [["license:deactivate"]], `${state} ${release}`);
      assert.deepEqual(fixture.toasts, [toast], `${state} ${release}`);
    }
  }
});

test("confirming the reset dialog sends license:reset with its exact confirmation", async () => {
  render(LicenseTab, status("unreadable"));
  const reset = dialog("Reset license data on this Mac?");
  await withIpc({ status: { state: "trial", daysLeft: 7 }, checkoutUrl: "" }, () =>
    reset.onConfirm(),
  );
  assert.deepEqual(fixture.invocations, [["license:reset", "reset-license-data-on-this-mac"]]);
  assert.deepEqual(fixture.toasts, [
    ["success", "License data on this Mac was reset. The old file was kept as a backup."],
  ]);

  // A refused reset shows the error instead.
  render(LicenseTab, status("unreadable"));
  const refused = dialog("Reset license data on this Mac?");
  globalThis.window = {
    dayboard: { ipc: { invoke: async () => Promise.reject(new Error("Keychain refused")) } },
  };
  try {
    refused.onConfirm();
    await Promise.all(fixture.runs);
  } finally {
    delete globalThis.window;
  }
  assert.deepEqual(fixture.toasts, [["error", "Error: Keychain refused"]]);
});
