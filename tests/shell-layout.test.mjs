import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: [new URL("../renderer/lib/shell.ts", import.meta.url).pathname],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const { inspectorWidth, separatorKey } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("details fit the 440px content minimum without overwriting remembered widths", () => {
  assert.equal(inspectorWidth(559, 280), null);
  assert.equal(inspectorWidth(681, 280), 240);
  assert.equal(inspectorWidth(721, 280), 280);
  assert.equal(inspectorWidth(859, 380), 380);
  assert.equal(inspectorWidth(800, 280), 280);
  assert.equal(inspectorWidth(859, 10000), 380);
});
test("splitter keys resize in 8/32px steps and clamp to pane bounds", () => {
  assert.equal(separatorKey("ArrowRight", false, 240, 180, 400), 248);
  assert.equal(separatorKey("ArrowLeft", true, 240, 180, 400), 208);
  assert.equal(separatorKey("ArrowRight", false, 280, 240, 380, -1), 272);
  assert.equal(separatorKey("Home", false, 280, 240, 380, -1), 240);
  assert.equal(separatorKey("End", false, 280, 240, 380, -1), 380);
  assert.equal(separatorKey("ArrowLeft", true, 375, 240, 380, -1), 380);
  assert.equal(separatorKey("Escape", false, 280, 240, 380), null);
});
