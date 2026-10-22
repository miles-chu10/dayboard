import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export function createQaBuildProofPlugin(): Plugin {
  let definitions: Record<string, unknown> = {};
  return {
    name: "dayboard:qa-build-proof",
    apply: "build",
    configResolved(config) {
      definitions = config.define ?? {};
    },
    generateBundle: {
      order: "post",
      handler(_options, bundle) {
        if (
          definitions.__DAYBOARD_QA_BUILD__ !== "true" ||
          definitions.__DAYBOARD_TEST_BUILD__ !== "false" ||
          definitions["process.env.DAYBOARD_LICENSE"] !== '"off"' ||
          definitions["process.env.DAYBOARD_RELEASE"] !== '""'
        )
          this.error(
            "QA packaging requires compiled demo isolation, licensing off and updates off.",
          );
        const chunks = Object.values(bundle).filter((output) => output.type === "chunk");
        if (!chunks.some((chunk) => chunk.isEntry && chunk.fileName === "index.js")) {
          this.error("QA packaging requires the main application entry.");
        }
        this.emitFile({
          type: "asset",
          fileName: "qa-build.json",
          source: JSON.stringify({
            schema: 1,
            qaBuild: true,
            demoOnly: true,
            googleConfigured: false,
            licensingDisabled: true,
            updatesEnabled: false,
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
