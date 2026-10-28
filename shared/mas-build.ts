import type { Plugin } from "vite";

/** Marks a main bundle compiled as the App Store edition; scripts/package-mas.mjs requires it. */
export function createMasBuildProofPlugin(): Plugin {
  let definitions: Record<string, unknown> = {};
  return {
    name: "dayboard:mas-build-proof",
    apply: "build",
    configResolved(config) {
      definitions = config.define ?? {};
    },
    generateBundle() {
      if (
        definitions.__DAYBOARD_MAS_BUILD__ !== "true" ||
        definitions["process.env.DAYBOARD_LICENSE"] !== '"off"' ||
        definitions["process.env.DAYBOARD_RELEASE"] !== '""'
      )
        this.error(
          "App Store packaging requires the App Store flag, licensing off and updates off.",
        );
      this.emitFile({ type: "asset", fileName: "mas-build.json", source: '{"mas":true}\n' });
    },
  };
}
