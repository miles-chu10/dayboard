#!/usr/bin/env node
// Issues, lists and revokes complimentary DayBoard Pro licenses through the billing Worker's admin
// routes. The admin token comes only from the environment, meant to be filled by 1Password:
//
//   op run --env-file=<file with DAYBOARD_ADMIN_TOKEN=op://...> -- \
//     node billing/scripts/comp-license.mjs issue --origin https://<billing origin> "beta tester 7"
//
// Issued keys are appended to a git-ignored *.local.jsonl file and never printed.
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const DEFAULT_OUT = fileURLToPath(new URL("../comp-licenses.local.jsonl", import.meta.url));
const OUT_SUFFIX = ".local.jsonl";
const MAX_KEYS = 50;
const LABEL_MAX = 64;
const LICENSE_ID = /^[A-Za-z0-9_-]{32}$/;
const LICENSE_KEY = /^DAYB_[A-Za-z0-9_-]{43}$/;
const ERROR_CODE = /^[a-z_]{1,64}$/;
const USAGE = `Usage:
  comp-license.mjs issue [--count N] [--out FILE] <label>...
  comp-license.mjs revoke <licenseId>...
  comp-license.mjs list

Options:
  --origin URL   Billing service origin (or DAYBOARD_BILLING_ORIGIN), e.g. https://api.example.com
  --count N      Keys per label, at most ${MAX_KEYS} keys per run. With N > 1, each label gets
                 " 1" to " N" appended.
  --out FILE     Where issued keys are appended. Must end in .local.jsonl (git-ignored).
                 Default: billing/comp-licenses.local.jsonl

Environment:
  DAYBOARD_ADMIN_TOKEN     The Worker's ADMIN_TOKEN. Pass it with 1Password "op run".
  DAYBOARD_BILLING_ORIGIN  Used when --origin is absent.

Labels are short notes such as "beta tester 7", 1-${LABEL_MAX} characters, never an email address.
`;

class UsageError extends Error {}

function iso(ms) {
  return Number.isSafeInteger(ms) && ms > 0 ? new Date(ms).toISOString() : "unknown time";
}

function serviceOrigin(value) {
  if (!value) throw new UsageError("Set --origin or DAYBOARD_BILLING_ORIGIN.");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("The billing origin is not a URL.");
  }
  // Plain HTTP only reaches this machine, for local testing. Anything else needs HTTPS.
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    !(url.protocol === "https:" || (url.protocol === "http:" && loopback))
  )
    throw new UsageError("The billing origin must be an HTTPS origin with no path or slash.");
  return url.origin;
}

function adminToken(env) {
  const token = env.DAYBOARD_ADMIN_TOKEN ?? "";
  if (token.length < 32)
    throw new UsageError("DAYBOARD_ADMIN_TOKEN is missing or shorter than 32 characters.");
  return token;
}

function checkLabel(label) {
  const trimmed = label.trim();
  if (
    !trimmed ||
    trimmed.length > LABEL_MAX ||
    trimmed.includes("@") ||
    Array.from(trimmed).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new UsageError(
      `Invalid label "${trimmed.slice(0, LABEL_MAX)}": use 1-${LABEL_MAX} characters and no email address.`,
    );
  return trimmed;
}

async function call(origin, token, method, path, body) {
  let response;
  try {
    response = await fetch(origin + path, {
      method,
      // Never let a redirect carry the token somewhere else.
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { status: 0, data: null };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    // A non-JSON answer is reported by status alone.
  }
  return { status: response.status, data };
}

function describe({ status, data }) {
  if (status === 0) return "the request failed before the service answered";
  const code = typeof data?.error === "string" && ERROR_CODE.test(data.error) ? data.error : "";
  return `HTTP ${status}${code ? ` ${code}` : ""}`;
}

async function issue(origin, token, labels, outPath, log) {
  // Opened before the first request, so an unwritable path costs no key.
  let handle;
  try {
    handle = await open(outPath, "a", 0o600);
  } catch (cause) {
    throw new UsageError(`Can't write ${outPath} (${cause?.code ?? "error"}).`);
  }
  let issued = 0;
  try {
    await handle.chmod(0o600);
    for (const label of labels) {
      const result = await call(origin, token, "POST", "/v1/admin/comp-licenses", { label });
      const data = result.data;
      if (
        result.status !== 201 ||
        !LICENSE_ID.test(data?.licenseId ?? "") ||
        !LICENSE_KEY.test(data?.licenseKey ?? "")
      ) {
        log.error(`Could not issue "${label}": ${describe(result)}.`);
        if (result.status === 0 || result.status >= 500)
          log.error("A key may have been issued anyway. Run list and revoke any unknown ID.");
        break;
      }
      const record = {
        licenseId: data.licenseId,
        label: data.label,
        licenseKey: data.licenseKey,
        createdAt: iso(data.createdAt),
        issuer: data.meta?.issuer,
        productId: data.meta?.productId,
        environment: data.meta?.environment,
      };
      try {
        await handle.write(`${JSON.stringify(record)}\n`);
        await handle.datasync();
      } catch {
        log.error(`Issued ${data.licenseId} but could not save its key. Revoke it:`);
        log.error(`  comp-license.mjs revoke ${data.licenseId}`);
        break;
      }
      issued++;
      log.out(`issued  ${data.licenseId}  ${record.environment}  ${data.label}`);
    }
  } finally {
    await handle.close();
  }
  if (issued) log.out(`Saved ${issued} key(s) to ${outPath}. Keys are not printed here.`);
  return issued === labels.length ? 0 : 1;
}

async function revoke(origin, token, ids, log) {
  let failures = 0;
  for (const licenseId of ids) {
    const result = await call(origin, token, "POST", "/v1/admin/comp-licenses/revoke", {
      licenseId,
    });
    if (result.status === 200 && result.data?.revoked === true) {
      log.out(`revoked ${licenseId}  ${iso(result.data.revokedAt)}`);
    } else {
      failures++;
      log.error(`Could not revoke ${licenseId}: ${describe(result)}.`);
    }
  }
  return failures ? 1 : 0;
}

async function list(origin, token, log) {
  const result = await call(origin, token, "GET", "/v1/admin/comp-licenses");
  if (result.status !== 200 || !Array.isArray(result.data?.licenses)) {
    log.error(`Could not list comp licenses: ${describe(result)}.`);
    return 1;
  }
  for (const row of result.data.licenses) {
    const state = row.revokedAt ? `revoked ${iso(row.revokedAt)}` : "active";
    log.out(
      `${row.licenseId}  ${row.environment}  ${iso(row.createdAt)}  ${state}  ${row.activations} Mac(s)  ${row.label}`,
    );
  }
  log.out(`${result.data.licenses.length} comp license(s).`);
  return 0;
}

async function main(argv, env, log) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      origin: { type: "string" },
      count: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    log.out(USAGE);
    return values.help ? 0 : 2;
  }
  if (!["issue", "revoke", "list"].includes(command))
    throw new UsageError(`Unknown command "${command}".`);
  if (command !== "issue" && (values.count !== undefined || values.out !== undefined))
    throw new UsageError("--count and --out apply only to issue.");
  if (command === "list" && rest.length) throw new UsageError("list takes no arguments.");
  if (command !== "list" && !rest.length) throw new UsageError(`${command} needs an argument.`);

  let labels = [];
  let outPath = DEFAULT_OUT;
  if (command === "issue") {
    const count = values.count === undefined ? 1 : Number(values.count);
    if (!/^[0-9]+$/.test(values.count ?? "1") || count < 1 || count > MAX_KEYS)
      throw new UsageError(`--count must be a whole number from 1 to ${MAX_KEYS}.`);
    for (const label of rest.map(checkLabel))
      for (let i = 1; i <= count; i++) labels.push(checkLabel(count > 1 ? `${label} ${i}` : label));
    if (labels.length > MAX_KEYS) throw new UsageError(`Issue at most ${MAX_KEYS} keys per run.`);
    if (values.out !== undefined) {
      if (!values.out.endsWith(OUT_SUFFIX))
        throw new UsageError(`--out must end in ${OUT_SUFFIX}, which git ignores.`);
      outPath = resolve(values.out);
    }
  }
  if (command === "revoke") {
    const bad = rest.find((id) => !LICENSE_ID.test(id));
    if (bad !== undefined) throw new UsageError(`"${bad}" is not a license ID.`);
  }
  const origin = serviceOrigin(values.origin ?? env.DAYBOARD_BILLING_ORIGIN);
  const token = adminToken(env);
  if (command === "issue") return issue(origin, token, labels, outPath, log);
  if (command === "revoke") return revoke(origin, token, rest, log);
  return list(origin, token, log);
}

const log = { out: (line) => console.log(line), error: (line) => console.error(line) };
try {
  process.exitCode = await main(process.argv.slice(2), process.env, log);
} catch (cause) {
  if (cause instanceof UsageError || String(cause?.code).startsWith("ERR_PARSE_ARGS")) {
    log.error(cause.message);
    log.error("Run with --help for usage.");
    process.exitCode = 2;
  } else {
    // Only the error code: no message that could quote a path's contents, the token or a key.
    log.error(`comp-license failed: ${cause?.code ?? cause?.name ?? "unknown error"}`);
    process.exitCode = 1;
  }
}
