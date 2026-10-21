import { createHash } from "node:crypto";
import path from "node:path";
import { extractFile, uncache } from "@electron/asar";

export function verifyQaBuild(read) {
  try {
    const proof = JSON.parse(read("qa-build.json").toString());
    if (
      proof.schema !== 1 ||
      proof.qaBuild !== true ||
      proof.demoOnly !== true ||
      proof.googleConfigured !== false ||
      proof.licensingDisabled !== true ||
      proof.updatesEnabled !== false ||
      !proof.files?.["index.js"]
    )
      throw new Error();
    for (const [name, hash] of Object.entries(proof.files)) {
      if (
        !/^(?:[\w-]+\/)*[\w.-]+\.js$/.test(name) ||
        !/^[a-f0-9]{64}$/.test(hash) ||
        createHash("sha256").update(read(name)).digest("hex") !== hash
      )
        throw new Error();
    }
  } catch {
    throw new Error("QA isolation verification failed. Rebuild with npm run package:qa.");
  }
}

export function verifyQaApp(app) {
  const archive = path.join(app, "Contents", "Resources", "app.asar");
  uncache(archive);
  verifyQaBuild((name) => extractFile(archive, `out/main/${name}`));
  const pkg = JSON.parse(extractFile(archive, "package.json").toString());
  if (
    pkg.main !== "out/main/index.js" ||
    pkg.name !== "dayboard-qa" ||
    pkg.productName !== "DayBoard QA"
  ) {
    throw new Error("Unexpected QA application entry or identity.");
  }
}
