import { createHash } from "node:crypto";
import type { Plugin } from "vite";

// Bind non-sensitive build facts to the emitted code. Packaging checks this proof
// inside app.asar, so a stale or differently configured rebuild cannot pass.
export function createBetaBuildProofPlugin(googleConfigured: () => boolean): Plugin {
  let definitions: Record<string, unknown> = {};
  return {
    name: "dayboard:beta-build-proof",
    apply: "build",
    configResolved(config) {
      definitions = config.define ?? {};
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (
          !googleConfigured() ||
          definitions["process.env.DAYBOARD_LICENSE"] !== '"off"' ||
          definitions["process.env.DAYBOARD_RELEASE"] !== '""' ||
          definitions.__DAYBOARD_TEST_BUILD__ !== "false"
        ) {
          this.error(
            "Beta packaging requires Google configuration, licensing off, updates off and a non-test build.",
          );
        }
        const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
        if (!chunks.some((chunk) => chunk.isEntry && chunk.fileName === "index.js")) {
          this.error("Beta packaging requires the main application entry.");
        }
        this.emitFile({
          type: "asset",
          fileName: "beta-build.json",
          source: JSON.stringify({
            schema: 1,
            googleConfigured: true,
            licensingDisabled: true,
            updatesEnabled: false,
            testBuild: false,
            files: Object.fromEntries(
              chunks.map((chunk) => [
                chunk.fileName,
                createHash("sha256").update(chunk.code).digest("hex"),
              ]),
            ),
          }),
        });
      },
    },
  };
}
