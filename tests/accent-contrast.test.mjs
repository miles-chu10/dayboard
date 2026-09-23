import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../renderer/lib/appearance.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent",
  plugins: [{ name: "stubs", setup(api) {
    api.onResolve({ filter: /^(react|\.\/settings|\.\/storage)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    api.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const useEffect = () => {}; export const useSettings = () => ({}); export const storedKey = (key) => key;", loader: "js" }));
  } }],
});
const { ACCENT_OPTIONS, accentLabelColor } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

test("every accent option keeps its button label at 3:1 or better in both schemes", () => {
  for (const option of ACCENT_OPTIONS.filter((item) => item.value !== "system")) {
    for (const hex of [option.light, option.dark]) {
      assert.ok(contrast(hex, accentLabelColor(hex)) >= 3, `${option.label} ${hex}`);
    }
  }
});

test("accent labels stay white where white is readable, matching macOS buttons", () => {
  assert.equal(accentLabelColor("#007AFF"), "#ffffff");
  assert.equal(accentLabelColor("#E0352B"), "#ffffff");
  assert.equal(accentLabelColor("#EE7A00"), "#000000");
  assert.equal(accentLabelColor("#FFD60A"), "#000000");
});
