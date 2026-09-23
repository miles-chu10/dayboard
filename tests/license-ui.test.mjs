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
  calls: [],
  retries: 0,
};
globalThis.__dayboardLicenseUiFixture = fixture;

const uiModule = `
  import React from "react";
  import { Button as RealButton } from ${JSON.stringify(path.join(root, "renderer/ui/button.tsx"))};
  export { EmptyState } from ${JSON.stringify(path.join(root, "renderer/ui/empty-state.tsx"))};
  export { Callout } from ${JSON.stringify(path.join(root, "renderer/ui/callout.tsx"))};
  export { Field, FieldSet } from ${JSON.stringify(path.join(root, "renderer/ui/field.tsx"))};
  export { Input } from ${JSON.stringify(path.join(root, "renderer/ui/input.tsx"))};
  export { Status } from ${JSON.stringify(path.join(root, "renderer/ui/status.tsx"))};
  export function Button(props) {
    globalThis.__dayboardLicenseUiFixture.buttons.push({ label: props.children, onClick: props.onClick });
    return React.createElement(RealButton, props);
  }
  export const toast = { error() {}, success() {} };
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
              export function useQuery() { return globalThis.__dayboardLicenseUiFixture.query; }
              export function useQueryClient() { return { setQueryData() {} }; }
              export function useMutation() { return { isPending: false, mutate() {} }; }
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
  fixture.calls = [];
  fixture.retries = 0;
  return renderToStaticMarkup(React.createElement(Component));
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
  assert.match(html, /Read-only access/);
  click("Read-only access · Activate");
  assert.deepEqual(fixture.calls, [["settings", "license"]]);
});
