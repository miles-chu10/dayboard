import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: [new URL("../main/platform/window-policy.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  logLevel: "silent",
});
const { windowEntryUrl, isAllowedWindowNavigation, isExternalWebUrl } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("privileged local windows accept only their exact document and hash routes", () => {
  const entry = windowEntryUrl("main-window.html", "/fixture/renderer");
  assert.equal(isAllowedWindowNavigation(entry, entry), true);
  assert.equal(isAllowedWindowNavigation(`${entry}#/mail`, entry), true);
  for (const target of [
    "file:///fixture/renderer/settings-window.html",
    "file:///fixture/private.html",
    `${entry}?remote=https://example.com`,
    "https://example.com/main-window.html",
    "javascript:alert(1)",
  ])
    assert.equal(isAllowedWindowNavigation(target, entry), false, target);
});

test("development navigation rejects origin and path prefix lookalikes", () => {
  const entry = windowEntryUrl("main-window.html", "/fixture", "http://localhost:5173/");
  assert.equal(isAllowedWindowNavigation(entry, entry), true);
  for (const target of [
    "http://localhost:51730/main-window.html",
    "http://localhost:5173/main-window.html.evil",
    "http://localhost:5173/other.html",
    "http://localhost.evil.test:5173/main-window.html",
  ])
    assert.equal(isAllowedWindowNavigation(target, entry), false, target);
  for (const origin of ["https://example.com", "http://user@localhost:5173", "file:///tmp/"])
    assert.throws(() => windowEntryUrl("main-window.html", "/fixture", origin));
  assert.throws(() => windowEntryUrl("../private.html", "/fixture"));
});

test("external link policy excludes executable schemes and embedded credentials", () => {
  assert.equal(isExternalWebUrl("https://example.com/help"), true);
  for (const url of [
    "file:///tmp/x",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "not a url",
  ])
    assert.equal(isExternalWebUrl(url), false, url);
});
