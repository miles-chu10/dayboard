import { Buffer } from "node:buffer";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../..", import.meta.url));
let sequence = 0;

/** Bundles an Electron-free TypeScript module from the repo root and imports it. */
export async function loadTs(relativePath, plugins = []) {
  const result = await build({
    entryPoints: [`${root}${relativePath}`],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    logLevel: "silent",
    plugins,
  });
  const source = `${result.outputFiles[0].text}\n// load-ts-${sequence++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
