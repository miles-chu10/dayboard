import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDeveloperIdentity,
  publishRelease,
  releasePlan,
  repository,
  stageAssets,
  verifyApp,
  writeCredentials,
} from "../scripts/macos-release.mjs";

// All files and API responses are synthetic. These tests never contact GitHub or Apple.
const sha = "a".repeat(40);
const team = "FIXTURE123";
const input = { repo: repository, ref: "refs/tags/v1.3.0", version: "1.3.0", sha };
const signature = `Authority=Developer ID Application: Fixture (${team})\nTeamIdentifier=${team}\nCodeDirectory flags=0x10000(runtime)\n`;
const hash = (data) => createHash("sha256").update(data).digest("hex");

async function temp(t) {
  const directory = await mkdtemp(join(tmpdir(), "dayboard-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function downloads(t, version = "1.3.0") {
  const root = await temp(t);
  const source = join(root, "source");
  const directory = join(root, "downloads");
  const plan = releasePlan({ ...input, version, ref: `refs/tags/v${version}` });
  await mkdir(source);
  for (const name of plan.files) await writeFile(join(source, name), `Synthetic download: ${name}`);
  await stageAssets(plan, source, directory);
  return { plan, directory, source };
}

function apiFixture({ releases = [], assets = [], failUpload, corruptAsset, tagSha = sha } = {}) {
  const calls = [];
  const state = { releases, assets, tagSha, tagReads: 0, moveAfterUpload: false, annotated: false };
  const call = (name, handler) => async (args) => {
    calls.push({ name, args });
    assert.equal(args.owner, "miles-chu10");
    assert.equal(args.repo, "dayboard");
    return { data: await handler(args) };
  };
  const repos = {
    listReleases: call("listReleases", () => state.releases),
    createRelease: call("createRelease", (args) => {
      const created = { ...args, id: 42 };
      state.releases.push(created);
      return created;
    }),
    listReleaseAssets: call("listReleaseAssets", () => state.assets),
    deleteReleaseAsset: call("deleteReleaseAsset", ({ asset_id }) => {
      state.assets = state.assets.filter((a) => a.id !== asset_id);
    }),
    uploadReleaseAsset: call("uploadReleaseAsset", ({ name, data }) => {
      assert.equal(state.releases[0].draft, true, "uploads must remain private");
      if (name === failUpload) throw new Error("Synthetic interrupted upload");
      state.assets.push({
        id: state.assets.length + 100,
        name,
        size: data.length,
        state: "uploaded",
        digest: `sha256:${name === corruptAsset ? "0".repeat(64) : hash(data)}`,
      });
      if (state.moveAfterUpload) state.tagSha = "b".repeat(40);
    }),
    updateRelease: call("updateRelease", (args) => {
      Object.assign(state.releases[0], args);
      return {
        ...state.releases[0],
        html_url: `https://github.com/${repository}/releases/tag/v1.3.0`,
      };
    }),
  };
  const github = {
    rest: {
      repos,
      git: {
        getRef: call("getRef", () => {
          state.tagReads++;
          return { object: { type: state.annotated ? "tag" : "commit", sha: state.tagSha } };
        }),
        getTag: call("getTag", () => ({ object: { type: "commit", sha: state.tagSha } })),
      },
    },
    paginate: async (method, args) => (await method(args)).data,
  };
  return { github, state, calls };
}

function publish(fixture, directory, version = "1.3.0") {
  return publishRelease({ github: fixture.github, repository, sha, tag: `v${version}`, directory });
}

function mutations(fixture) {
  return fixture.calls.filter(({ name }) => /^(create|delete|upload|update)/.test(name));
}

test("matching stable and prerelease tags produce versioned arm64 downloads", () => {
  const stable = releasePlan(input);
  assert.equal(stable.prerelease, false);
  assert.ok(stable.files.includes("DayBoard-1.3.0-arm64.dmg"));
  assert.ok(stable.files.includes("DayBoard-1.3.0-arm64-mac.zip"));
  assert.equal(
    releasePlan({ ...input, ref: "refs/tags/v2.0.0-beta.2", version: "2.0.0-beta.2" }).prerelease,
    true,
  );
});

for (const [name, override] of [
  ["another repository", { repo: "miles-chu10/another-app" }],
  ["a branch", { ref: "refs/heads/main" }],
  ["a mismatched version", { version: "1.3.1" }],
  ["an invalid SHA", { sha: "main" }],
  ["a path in a tag", { version: "../private", ref: "refs/tags/v../private" }],
  ["leading version zeroes", { version: "01.3.0", ref: "refs/tags/v01.3.0" }],
  ["leading prerelease zeroes", { version: "1.3.0-beta.02", ref: "refs/tags/v1.3.0-beta.02" }],
  ["a newline in a tag", { version: "1.3.0\nsha=bad", ref: "refs/tags/v1.3.0\nsha=bad" }],
])
  test(`release planning refuses ${name}`, () =>
    assert.throws(() => releasePlan({ ...input, ...override })));

test("ad-hoc, development and other-team signatures are refused", () => {
  assert.doesNotThrow(() => assertDeveloperIdentity(signature, team));
  for (const value of [
    "Signature=adhoc",
    signature.replace("Developer ID Application", "Apple Development"),
    signature.replace(`TeamIdentifier=${team}`, "TeamIdentifier=WRONG12345"),
  ])
    assert.throws(() => assertDeveloperIdentity(value, team));
});

function signedTools({ runtime = true, version = "1.3.0", helper = signature, fail } = {}) {
  return (command, args) => {
    if (command === fail) throw new Error("Synthetic verification failure");
    if (command === "codesign" && args[0] === "--display")
      return args.at(-1).endsWith("reminders-helper")
        ? helper
        : runtime
          ? signature
          : signature.replace("runtime", "none");
    if (command === "plutil") return version;
    return "";
  };
}

test("app verification checks hardened runtime, nested helper, version, ticket and Gatekeeper", () => {
  assert.doesNotThrow(() => verifyApp("/fixture/DayBoard.app", team, "1.3.0", signedTools()));
  for (const options of [
    { runtime: false },
    { version: "1.2.0" },
    { helper: "Signature=adhoc" },
    { fail: "codesign" },
    { fail: "xcrun" },
    { fail: "spctl" },
  ])
    assert.throws(() => verifyApp("/fixture/DayBoard.app", team, "1.3.0", signedTools(options)));
});

const credentials = {
  MACOS_CERTIFICATE_P12_BASE64: Buffer.from("synthetic PKCS12 fixture").toString("base64"),
  CSC_KEY_PASSWORD: "fixture-password",
  MACOS_NOTARY_KEY_P8:
    "-----BEGIN PRIVATE KEY-----\nsynthetic-key-fixture\n-----END PRIVATE KEY-----",
  APPLE_API_KEY_ID: "FIXTUREKEY",
  APPLE_API_ISSUER: "00000000-0000-0000-0000-000000000000",
  APPLE_TEAM_ID: team,
  DAYBOARD_GOOGLE_OAUTH_JSON: JSON.stringify({
    clientId: "fixture.apps.googleusercontent.com",
    clientSecret: "fixture-value",
  }),
};

test("temporary credential files and directory are owner-only and cannot overwrite existing files", async (t) => {
  const root = await temp(t);
  const directory = join(root, "credentials");
  await writeCredentials(credentials, directory);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const file of ["certificate.p12", "notary.p8", "google-oauth.json"])
    assert.equal((await stat(join(directory, file))).mode & 0o777, 0o600);
  await assert.rejects(writeCredentials(credentials, directory));
});

test("missing and malformed credentials fail before creating files, without revealing values", async (t) => {
  const root = await temp(t);
  for (const name of Object.keys(credentials)) {
    const directory = join(root, name);
    await assert.rejects(
      writeCredentials({ ...credentials, [name]: "" }, directory),
      new RegExp(name),
    );
    await assert.rejects(stat(directory), { code: "ENOENT" });
  }
  for (const override of [
    { APPLE_API_ISSUER: "-".repeat(36) },
    { MACOS_CERTIFICATE_P12_BASE64: "bad===" },
    { MACOS_NOTARY_KEY_P8: "not-a-key" },
    { DAYBOARD_GOOGLE_OAUTH_JSON: "private-sentinel-invalid-json" },
    { DAYBOARD_GOOGLE_OAUTH_JSON: '{"clientSecret":"private-sentinel"}' },
  ]) {
    await assert.rejects(
      writeCredentials({ ...credentials, ...override }, join(root, "bad")),
      (error) => {
        assert.doesNotMatch(error.message, /private-sentinel/);
        return true;
      },
    );
  }
});

test("download staging includes checksums of every expected file", async (t) => {
  const { plan, directory } = await downloads(t);
  const manifest = JSON.parse(await readFile(join(directory, "release-manifest.json"), "utf8"));
  assert.equal(manifest.sha, sha);
  assert.equal(manifest.assets.length, plan.files.length + 1);
  for (const asset of manifest.assets)
    assert.equal(hash(await readFile(join(directory, asset.name))), asset.sha256);
});

for (const unsafe of ["missing", "empty", "symlink"])
  test(`staging refuses a ${unsafe} download`, async (t) => {
    const { plan, source, directory } = await downloads(t);
    const file = join(source, plan.files[0]);
    await rm(file);
    if (unsafe === "empty") await writeFile(file, "");
    if (unsafe === "symlink") await symlink(join(source, plan.files[1]), file);
    await assert.rejects(stageAssets(plan, source, directory));
  });

test("publisher verifies every uploaded hash before making a stable release public", async (t) => {
  const { plan, directory } = await downloads(t);
  const fixture = apiFixture();
  await publish(fixture, directory);
  assert.equal(fixture.state.assets.length, plan.files.length + 2);
  assert.equal(fixture.state.releases[0].draft, false);
  assert.equal(fixture.state.releases[0].prerelease, false);
  assert.equal(fixture.state.releases[0].make_latest, "legacy");
  assert.equal(fixture.calls.at(-1).name, "updateRelease");
  assert.equal(fixture.state.tagReads, 2);
});

test("signed beta tags become prereleases and never replace the stable latest release", async (t) => {
  const version = "1.3.0-beta.2";
  const { directory } = await downloads(t, version);
  const fixture = apiFixture();
  fixture.state.annotated = true;
  await publish(fixture, directory, version);
  assert.equal(fixture.state.releases[0].prerelease, true);
  assert.equal(fixture.state.releases[0].make_latest, "false");
  assert.equal(fixture.calls.filter(({ name }) => name === "getTag").length, 2);
});

for (const kind of ["bytes", "manifest", "repository", "path"])
  test(`tampered ${kind} cause no GitHub writes`, async (t) => {
    const { plan, directory } = await downloads(t);
    if (kind === "bytes") await writeFile(join(directory, plan.files[0]), "tampered");
    else {
      const file = join(directory, "release-manifest.json");
      const manifest = JSON.parse(await readFile(file, "utf8"));
      if (kind === "manifest") manifest.sha = "b".repeat(40);
      if (kind === "repository") manifest.repository = "someone/else";
      if (kind === "path") manifest.assets[0].name = "../private";
      await writeFile(file, JSON.stringify(manifest));
    }
    const fixture = apiFixture();
    await assert.rejects(publish(fixture, directory));
    assert.deepEqual(mutations(fixture), []);
  });

for (const options of [{ failUpload: "latest-mac.yml" }, { corruptAsset: "release-manifest.json" }])
  test(`failed or corrupt upload remains a draft (${JSON.stringify(options)})`, async (t) => {
    const { directory } = await downloads(t);
    const fixture = apiFixture(options);
    await assert.rejects(publish(fixture, directory));
    assert.equal(fixture.state.releases[0].draft, true);
    assert.equal(
      fixture.calls.some(({ name }) => name === "updateRelease"),
      false,
    );
  });

const ownDraft = () => ({
  id: 42,
  draft: true,
  tag_name: "v1.3.0",
  body: `<!-- dayboard-signed-release:${sha} -->`,
});

test("published releases and unrelated drafts remain untouched", async (t) => {
  const { directory } = await downloads(t);
  for (const release of [
    { ...ownDraft(), draft: false },
    { ...ownDraft(), body: "manual notes" },
  ]) {
    const fixture = apiFixture({ releases: [release] });
    await assert.rejects(publish(fixture, directory));
    assert.deepEqual(mutations(fixture), []);
  }
});

test("interrupted uploads resume only their matching draft and replace partial assets", async (t) => {
  const { plan, directory } = await downloads(t);
  const fixture = apiFixture({
    releases: [ownDraft()],
    assets: [{ id: 4, name: plan.files[0], state: "starter" }],
  });
  await publish(fixture, directory);
  assert.equal(
    fixture.calls.some(({ name }) => name === "createRelease"),
    false,
  );
  assert.equal(fixture.calls.filter(({ name }) => name === "deleteReleaseAsset").length, 1);
  assert.equal(fixture.state.releases[0].draft, false);
});

test("unrecognized draft assets are preserved without publication", async (t) => {
  const { directory } = await downloads(t);
  const fixture = apiFixture({ releases: [ownDraft()], assets: [{ id: 5, name: "manual.zip" }] });
  await assert.rejects(publish(fixture, directory));
  assert.deepEqual(mutations(fixture), []);
});

test("moved tags cannot publish either before or after uploads", async (t) => {
  const { directory } = await downloads(t);
  const before = apiFixture({ tagSha: "b".repeat(40) });
  await assert.rejects(publish(before, directory));
  assert.deepEqual(mutations(before), []);
  const during = apiFixture();
  during.state.moveAfterUpload = true;
  await assert.rejects(publish(during, directory));
  assert.equal(during.state.releases[0].draft, true);
});
