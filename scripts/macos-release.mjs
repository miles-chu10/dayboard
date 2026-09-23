import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { appendFile, copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const repository = "miles-chu10/dayboard";
const semver =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function releasePlan({ repo, ref, version, sha }) {
  const tag = ref?.startsWith("refs/tags/") ? ref.slice(10) : "";
  const parsed = semver.exec(tag);
  if (repo !== repository || !parsed || tag !== `v${version}` || !/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("Release requires a matching version tag and commit in miles-chu10/dayboard.");
  if (
    parsed[4]?.split(".").some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")
  )
    throw new Error("Numeric prerelease identifiers cannot have leading zeroes.");
  const dmg = `DayBoard-${version}-arm64.dmg`;
  const zip = `DayBoard-${version}-arm64-mac.zip`;
  return {
    repository,
    tag,
    version,
    sha,
    prerelease: Boolean(parsed[4]),
    files: [dmg, zip, `${dmg}.blockmap`, `${zip}.blockmap`, "latest-mac.yml"],
  };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command} failed during the release check.`);
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

export function assertDeveloperIdentity(description, team) {
  if (
    !/^[A-Z0-9]{10}$/.test(team ?? "") ||
    !/^Authority=Developer ID Application:/m.test(description) ||
    !description.split(/\r?\n/).includes(`TeamIdentifier=${team}`)
  )
    throw new Error("The artifact is not signed by the configured Developer ID team.");
}

export function verifyApp(appPath, team, version, execute = run) {
  execute("codesign", ["--verify", "--deep", "--strict", appPath]);
  const signature = execute("codesign", ["--display", "--verbose=4", appPath]);
  assertDeveloperIdentity(signature, team);
  if (!/flags=[^\n]*\bruntime\b/.test(signature)) throw new Error("Hardened runtime is required.");
  const info = join(appPath, "Contents", "Info.plist");
  if (
    execute("plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", info]).trim() !==
    version
  )
    throw new Error("The packaged app version does not match the release tag.");
  const helper = join(appPath, "Contents", "Resources", "bin", "reminders-helper");
  execute("codesign", ["--verify", "--strict", helper]);
  assertDeveloperIdentity(execute("codesign", ["--display", "--verbose=4", helper]), team);
  execute("xcrun", ["stapler", "validate", appPath]);
  execute("spctl", ["--assess", "--type", "execute", "--verbose=2", appPath]);
}

export async function writeCredentials(env, directory) {
  const names = [
    "MACOS_CERTIFICATE_P12_BASE64",
    "CSC_KEY_PASSWORD",
    "MACOS_NOTARY_KEY_P8",
    "APPLE_API_KEY_ID",
    "APPLE_API_ISSUER",
    "APPLE_TEAM_ID",
    "DAYBOARD_GOOGLE_OAUTH_JSON",
  ];
  for (const name of names)
    if (!env[name]?.trim()) throw new Error(`Missing release configuration: ${name}`);
  if (
    !/^[A-Z0-9]{10}$/.test(env.APPLE_API_KEY_ID) ||
    !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID) ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.APPLE_API_ISSUER)
  )
    throw new Error("Invalid Apple key, issuer or team identifier.");
  let google;
  try {
    google = JSON.parse(env.DAYBOARD_GOOGLE_OAUTH_JSON);
  } catch {
    throw new Error("Invalid Google OAuth JSON.");
  }
  if (
    typeof google?.clientId !== "string" ||
    !google.clientId.endsWith(".apps.googleusercontent.com") ||
    typeof google.clientSecret !== "string" ||
    !google.clientSecret
  )
    throw new Error("Google Desktop OAuth client configuration is required.");
  const encoded = env.MACOS_CERTIFICATE_P12_BASE64.replace(/\s/g, "");
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
    Buffer.from(encoded, "base64").toString("base64") !== encoded
  )
    throw new Error("The signing certificate must be base64-encoded PKCS#12.");
  if (
    !env.MACOS_NOTARY_KEY_P8.includes("-----BEGIN PRIVATE KEY-----") ||
    !env.MACOS_NOTARY_KEY_P8.includes("-----END PRIVATE KEY-----")
  )
    throw new Error("The notarization key must be a PKCS#8 .p8 key.");
  await mkdir(directory, { mode: 0o700 });
  await writeFile(join(directory, "certificate.p12"), Buffer.from(encoded, "base64"), {
    mode: 0o600,
  });
  await writeFile(join(directory, "notary.p8"), env.MACOS_NOTARY_KEY_P8, { mode: 0o600 });
  await writeFile(
    join(directory, "google-oauth.json"),
    JSON.stringify({ clientId: google.clientId, clientSecret: google.clientSecret }),
    { mode: 0o600 },
  );
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function stageAssets(plan, source, directory) {
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const name of plan.files) {
    const file = join(source, name);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size === 0)
      throw new Error("A required release asset is missing or unsafe.");
    await copyFile(file, join(directory, name));
    assets.push({ name, bytes: stat.size, sha256: await digest(file) });
  }
  await writeFile(
    join(directory, "SHA256SUMS.txt"),
    assets.map((a) => `${a.sha256}  ${a.name}\n`).join(""),
  );
  const sums = await lstat(join(directory, "SHA256SUMS.txt"));
  assets.push({
    name: "SHA256SUMS.txt",
    bytes: sums.size,
    sha256: await digest(join(directory, "SHA256SUMS.txt")),
  });
  await writeFile(
    join(directory, "release-manifest.json"),
    `${JSON.stringify({ ...plan, assets }, null, 2)}\n`,
  );
}

export async function publishRelease({ github, repository: repo, tag, sha, directory }) {
  const manifestData = await readFile(join(directory, "release-manifest.json"));
  const manifest = JSON.parse(manifestData.toString("utf8"));
  const plan = releasePlan({ repo, ref: `refs/tags/${tag}`, version: manifest.version, sha });
  if (
    manifest.sha !== sha ||
    manifest.tag !== tag ||
    manifest.repository !== repo ||
    JSON.stringify(manifest.assets?.map((a) => a.name)) !==
      JSON.stringify([...plan.files, "SHA256SUMS.txt"])
  )
    throw new Error("Release manifest does not match this workflow.");
  for (const asset of manifest.assets) {
    const file = join(directory, asset.name);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size !== asset.bytes || (await digest(file)) !== asset.sha256)
      throw new Error("Release asset integrity check failed.");
  }
  const [owner, name] = repo.split("/");
  const api = github.rest.repos;
  async function verifyTag() {
    let object = (await github.rest.git.getRef({ owner, repo: name, ref: `tags/${tag}` })).data
      .object;
    // Annotated tags need peeling; never recreate a deleted or moved release tag.
    for (let depth = 0; object.type === "tag" && depth < 10; depth++)
      object = (await github.rest.git.getTag({ owner, repo: name, tag_sha: object.sha })).data
        .object;
    if (object.type !== "commit" || object.sha !== sha)
      throw new Error("The release tag no longer points to the verified commit.");
  }
  await verifyTag();
  const marker = `<!-- dayboard-signed-release:${sha} -->`;
  // The by-tag endpoint only promises published releases. List to include drafts.
  const matches = (
    await github.paginate(api.listReleases, { owner, repo: name, per_page: 100 })
  ).filter((item) => item.tag_name === tag);
  if (matches.length > 1)
    throw new Error("Multiple releases use this tag; resolve them before retrying.");
  let release = matches[0];
  if (release && (!release.draft || !release.body?.includes(marker)))
    throw new Error("An existing release will not be replaced. Use a new version tag.");
  if (!release) {
    release = (
      await api.createRelease({
        owner,
        repo: name,
        tag_name: tag,
        target_commitish: sha,
        name: `DayBoard ${plan.version}`,
        body: `${marker}\n\nDeveloper ID signed, notarized macOS app for Apple Silicon. Download the DMG to install; ZIP, blockmaps and update metadata support app updates. Checksums are attached.`,
        draft: true,
        prerelease: plan.prerelease,
        generate_release_notes: true,
      })
    ).data;
  }
  // Keep incomplete uploads private. Only this workflow's own draft can be resumed.
  const assets = [
    ...manifest.assets,
    {
      name: "release-manifest.json",
      bytes: manifestData.length,
      sha256: createHash("sha256").update(manifestData).digest("hex"),
    },
  ];
  const existing = await github.paginate(api.listReleaseAssets, {
    owner,
    repo: name,
    release_id: release.id,
    per_page: 100,
  });
  if (existing.some((item) => !assets.some((asset) => asset.name === item.name)))
    throw new Error("Unexpected draft assets require review before publication.");
  for (const asset of assets) {
    const old = existing.find((item) => item.name === asset.name);
    if (old) await api.deleteReleaseAsset({ owner, repo: name, asset_id: old.id });
    const data = await readFile(join(directory, asset.name));
    await api.uploadReleaseAsset({
      owner,
      repo: name,
      release_id: release.id,
      name: asset.name,
      data,
      headers: { "content-type": "application/octet-stream", "content-length": data.length },
    });
  }
  const verified = await github.paginate(api.listReleaseAssets, {
    owner,
    repo: name,
    release_id: release.id,
    per_page: 100,
  });
  for (const asset of assets)
    if (
      verified.length !== assets.length ||
      !verified.some(
        (item) =>
          item.name === asset.name &&
          item.size === asset.bytes &&
          item.state === "uploaded" &&
          item.digest === `sha256:${asset.sha256}`,
      )
    )
      throw new Error("Release uploads did not finish; the release remains a draft.");
  await verifyTag();
  const published = (
    await api.updateRelease({
      owner,
      repo: name,
      release_id: release.id,
      draft: false,
      prerelease: plan.prerelease,
      make_latest: plan.prerelease ? "false" : "legacy",
    })
  ).data;
  return { url: published.html_url };
}

async function main(command) {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    process.env.GITHUB_REPOSITORY !== repository ||
    !process.env.RUNNER_TEMP
  )
    throw new Error("This command is restricted to DayBoard's GitHub Actions release job.");
  const temp = process.env.RUNNER_TEMP;
  const credentials = join(temp, "dayboard-release-credentials");
  const planFile = join(temp, "dayboard-release-plan.json");
  if (command === "cleanup") return rm(credentials, { force: true, recursive: true });
  if (command === "plan") {
    if (process.arch !== "arm64" || process.platform !== "darwin")
      throw new Error("An Apple Silicon macOS runner is required.");
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    if (pkg.name !== "dayboard" || pkg.main !== "out/main/index.js")
      throw new Error("The standalone DayBoard package is required.");
    const sha = run("git", ["rev-parse", "HEAD"]).trim();
    const plan = releasePlan({
      repo: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      version: pkg.version,
      sha,
    });
    run("git", ["merge-base", "--is-ancestor", sha, "origin/main"]);
    await writeFile(planFile, JSON.stringify(plan));
    return appendFile(process.env.GITHUB_OUTPUT, `tag=${plan.tag}\nsha=${sha}\n`);
  }
  if (command === "credentials") return writeCredentials(process.env, credentials);
  const plan = JSON.parse(await readFile(planFile, "utf8"));
  if (command === "stage")
    return stageAssets(plan, "release", join(temp, "dayboard-release-assets"));
  if (command !== "verify") throw new Error("Unknown release command.");
  const team = process.env.APPLE_TEAM_ID;
  const app = resolve("release/mac-arm64/DayBoard.app");
  verifyApp(app, team, plan.version);
  const zipDirectory = join(temp, "dayboard-release-zip");
  await mkdir(zipDirectory);
  run("ditto", ["-x", "-k", resolve("release", plan.files[1]), zipDirectory]);
  verifyApp(join(zipDirectory, "DayBoard.app"), team, plan.version);
  const mount = join(temp, "dayboard-release-dmg");
  await mkdir(mount);
  const dmg = resolve("release", plan.files[0]);
  run("hdiutil", ["verify", dmg]);
  run("codesign", ["--verify", "--strict", dmg]);
  assertDeveloperIdentity(run("codesign", ["--display", "--verbose=4", dmg]), team);
  run("hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, dmg]);
  try {
    verifyApp(join(mount, "DayBoard.app"), team, plan.version);
  } finally {
    run("hdiutil", ["detach", mount]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
