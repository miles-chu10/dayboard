import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(directory) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    return statSync(full).isDirectory() ? sources(full) : full.endsWith(".ts") ? [full] : [];
  });
}

// electron-vite copies `?asset` imports into out/ only when they live outside resources/; files
// under resources/ resolve to a path outside app.asar, so the packaged app would not find them.
test("main-process ?asset imports ship inside the build output", () => {
  const imports = sources(path.join(root, "main")).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/from "([^"]+)\?asset"/g)].map((match) => ({
      file,
      target: path.resolve(path.dirname(file), match[1]),
    })),
  );
  assert.ok(imports.length > 0, "expected the tray images to be imported as assets");
  for (const { file, target } of imports) {
    assert.ok(existsSync(target), `${path.relative(root, file)} imports a missing ${target}`);
    assert.ok(
      !path.relative(path.join(root, "resources"), target).match(/^[^.]/),
      `${path.relative(root, file)} imports ${path.relative(root, target)} from resources/`,
    );
  }
});
