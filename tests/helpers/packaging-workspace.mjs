import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { cp, lstat, mkdir, mkdtemp, readdir, readlink, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createOwnedProcessScope } from "./owned-process.mjs";

const execute = promisify(execFile);
const outputs = ["out", "release", "resources/bin"];
const within = (root, file) => {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
  );
};

export async function withPackagingWorkspace(source, callback) {
  const root = await realpath(source);
  const temporaryRoot = await realpath(tmpdir());
  if (within(root, temporaryRoot)) {
    throw new Error("Packaging fixtures require a temporary directory outside the checkout.");
  }
  const directory = await mkdtemp(path.join(temporaryRoot, "dayboard-beta-fixture-"));
  const workspace = path.join(directory, "source");
  const processes = createOwnedProcessScope(workspace);
  try {
    await mkdir(workspace);
    const { stdout } = await execute("git", ["ls-files", "-z"], {
      cwd: root,
      maxBuffer: 10 * 1024 * 1024,
    });
    // Copy tracked working-tree contents, including staged edits, never the
    // developer's ignored output, OAuth files, environment files or Git state.
    for (const file of stdout.split("\0").filter(Boolean)) {
      if ([...outputs, "node_modules"].some((name) => file === name || file.startsWith(`${name}/`)))
        continue;
      const original = path.join(root, file);
      const copy = path.join(workspace, file);
      if (
        !within(workspace, copy) ||
        !within(root, await realpath(original)) ||
        !(await lstat(original)).isFile()
      ) {
        throw new Error(
          "Packaging fixtures require regular tracked source files inside the checkout.",
        );
      }
      await mkdir(path.dirname(copy), { recursive: true });
      await cp(original, copy, { mode: constants.COPYFILE_FICLONE });
    }
    const dependencies = path.join(root, "node_modules");
    if (!(await lstat(dependencies)).isDirectory()) {
      throw new Error(
        "Packaging fixtures require an installed node_modules directory, not a link.",
      );
    }
    // Native rebuilds must mutate a private copy, not a node_modules symlink or
    // hard-linked tree. Relative npm .bin links remain inside that copied tree.
    await cp(dependencies, path.join(workspace, "node_modules"), {
      recursive: true,
      mode: constants.COPYFILE_FICLONE,
      verbatimSymlinks: true,
      filter: async (file) => {
        if ((await lstat(file)).isSymbolicLink()) {
          const target = await readlink(file);
          if (
            path.isAbsolute(target) ||
            !within(dependencies, path.resolve(path.dirname(file), target)) ||
            !within(dependencies, await realpath(file))
          ) {
            throw new Error(
              "Packaging fixture dependencies cannot link outside their copied tree.",
            );
          }
        }
        return true;
      },
    });
    return await callback({ directory, workspace, run: processes.run });
  } finally {
    // Stop and await owned commands even if the callback throws while one is
    // active. If termination is unconfirmed, close throws and retains the files.
    await processes.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function snapshotPackagingOutputs(root) {
  const entries = {};
  async function visit(relative) {
    const file = path.join(root, relative);
    let stat;
    try {
      stat = await lstat(file);
    } catch (error) {
      if (error.code === "ENOENT") {
        entries[relative] = null;
        return;
      }
      throw error;
    }
    const entry = { mode: stat.mode, mtimeMs: stat.mtimeMs };
    if (stat.isSymbolicLink()) entry.link = await readlink(file);
    else if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort()) await visit(path.join(relative, name));
    } else if (stat.isFile()) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      entry.sha256 = hash.digest("hex");
      entry.bytes = stat.size;
    } else throw new Error("Unexpected file type in packaging outputs.");
    entries[relative] = entry;
  }
  for (const output of outputs) await visit(output);
  return entries;
}
