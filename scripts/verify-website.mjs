// Post-deploy check for the website on Cloudflare Pages and its beta signup API. It signs up one
// synthetic address and ends by printing the D1 commands that confirm and delete that row.
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const USAGE =
  "Usage: node scripts/verify-website.mjs --site <site-origin> --api <api-origin> [--skip-pages] [--www] [--rate-limit] [--email <address>] [--database <d1-name>]";
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
const PAGES = ["/", "/beta.html", "/docs.html", "/support.html", "/privacy.html", "/license.html"];
const OTHER_ORIGIN = "https://verify.example.invalid";
// Asset kind, file extensions, plausible content types.
const KINDS = [
  ["style", /\.css$/i, /^text\/css$/],
  ["script", /\.m?js$/i, /javascript|ecmascript/],
  ["font", /\.(woff2?|ttf|otf)$/i, /^(font\/|application\/(x-)?font)/],
  ["image", /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i, /^image\//],
];

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  process.exit(2);
}

let args;
try {
  args = parseArgs({
    options: {
      site: { type: "string" },
      api: { type: "string" },
      "skip-pages": { type: "boolean" },
      www: { type: "boolean" },
      "rate-limit": { type: "boolean" },
      email: { type: "string" },
      database: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  }).values;
} catch (error) {
  usage(error.message);
}
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

function origin(flag) {
  const value = args[flag];
  if (!value) usage(`--${flag} is required.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    usage(`--${flag} must be an origin such as https://example.com.`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.includes(url.hostname)))
    usage(`--${flag} must start with https:// (http:// is allowed only for localhost).`);
  if (url.origin !== value.replace(/\/$/, ""))
    usage(
      `--${flag} must be exactly ${url.origin} (lowercase host, no default port, path, query or fragment).`,
    );
  return url;
}

const site = origin("site");
const api = origin("api");
const SITE = site.origin;
const ENDPOINT = `${api.origin}/v1/beta-signup`;
const stamp = Date.now();
const email = (args.email ?? `dayboard-verify+${stamp}@example.com`).trim().toLowerCase();
// A narrow character set keeps the printed SQL and shell commands safe to paste.
if (!/^[a-z0-9._+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email))
  usage("--email must be a plain address made of letters, digits and . _ + -");
if (args.database !== undefined && !/^[\w-]+$/.test(args.database))
  usage("--database must be a D1 database name.");
const honeypot = email.replace("@", "+honeypot@");
const loopbackSite = LOOPBACK.includes(site.hostname);

const counts = { PASS: 0, FAIL: 0, WARN: 0 };
function report(level, name, detail) {
  counts[level]++;
  console.log(`${level} ${name}${detail ? ` — ${detail}` : ""}`);
}
const check = (name, ok, detail) => report(ok ? "PASS" : "FAIL", name, detail);
const warn = (name, detail) => report("WARN", name, detail);

async function send(url, { method = "GET", headers, body, redirect = "follow" } = {}) {
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      redirect,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      status: response.status,
      headers: response.headers,
      url: response.url,
      text,
      json: json && typeof json === "object" ? json : {},
    };
  } catch (error) {
    const reason =
      error.name === "TimeoutError"
        ? "no answer within 15 s"
        : error.cause?.message || error.cause?.code || error.message;
    return {
      status: 0,
      headers: new Headers(),
      url,
      text: "",
      json: {},
      error: `failed: ${reason}`,
    };
  }
}

const contentType = (res) =>
  res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
function safeUrl(href, base) {
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function describe(res) {
  if (res.error) return res.error;
  if (res.status >= 300 && res.status < 400)
    return `${res.status} to ${res.headers.get("location") ?? "no Location"}`;
  const what = res.json.error ?? (res.json.ok === true ? "ok" : contentType(res));
  return what ? `${res.status} ${what}` : `${res.status}`;
}

const HINTS = new Map([
  [
    "signup_unconfigured",
    "check SITE_ORIGIN (the exact https site origin), HASH_SECRET (32+ characters) and the D1 binding",
  ],
  ["origin_mismatch", `SERVICE_ORIGIN doesn't match ${api.origin}`],
  ["origin_not_allowed", `SITE_ORIGIN doesn't match ${SITE}`],
  ["rate_limited", "rate limited early; wait a minute and rerun"],
  ["service_unavailable", "the Worker failed; check that every billing/migrations file is applied"],
  [
    "service_unconfigured",
    "the deployed Worker has no beta signup route; deploy the current billing/ Worker",
  ],
]);
function explain(res) {
  const hint =
    res.headers.get("cf-mitigated") === "challenge"
      ? "Cloudflare answered with a bot challenge; let scripted requests reach the API"
      : (HINTS.get(res.json.error) ?? (res.status === 404 ? `nothing answers ${ENDPOINT}` : ""));
  return hint ? `${describe(res)}: ${hint}` : describe(res);
}

function attributes(text) {
  const attrs = {};
  for (const [, name, ...values] of text.matchAll(
    /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  ))
    attrs[name.toLowerCase()] ??= (values.find((value) => value !== undefined) ?? "").replaceAll(
      "&amp;",
      "&",
    );
  return attrs;
}
const tags = (html) =>
  [...html.matchAll(/<(link|script|img|source|meta)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)].map(
    ([, name, text]) => ({ name: name.toLowerCase(), attrs: attributes(text) }),
  );
const inlineScripts = (html) =>
  [...html.matchAll(/<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter(([, text, body]) => {
      const { src, type = "" } = attributes(text);
      return src === undefined && body && /^(|module|(text|application)\/javascript)$/i.test(type);
    })
    .map(([, , body]) => body.replace(/\r\n?/g, "\n"));

// The source list that governs a fetch: the first directive present, like default-src fallback.
function sources(policy, directives) {
  const found = new Map();
  for (const part of policy.split(";")) {
    const [name, ...list] = part.trim().split(/\s+/);
    if (name && !found.has(name.toLowerCase())) found.set(name.toLowerCase(), list);
  }
  return directives.map((name) => found.get(name)).find(Boolean) ?? null;
}
function allowsUrl(list, target) {
  const url = new URL(target);
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  return (
    !list ||
    list.some((raw) => {
      const source = raw.toLowerCase();
      if (source === "*") return /^(https?|wss?):$/.test(url.protocol);
      if (source === "'self'") return url.origin === SITE;
      if (/^[a-z][a-z0-9+.-]*:$/.test(source))
        return url.protocol === source || (source === "http:" && url.protocol === "https:");
      const match =
        /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+)(?::(\*|\d+))?(\/[^?#]*)?$/.exec(
          source,
        );
      if (!match) return false;
      const [, scheme = site.protocol.slice(0, -1), host, port, path] = match;
      return (
        (url.protocol === `${scheme}:` || (scheme === "http" && url.protocol === "https:")) &&
        (host === "*" ||
          url.hostname === host ||
          (host.startsWith("*.") && url.hostname.endsWith(host.slice(1)))) &&
        (port === "*" || (port ?? defaultPort) === (url.port || defaultPort)) &&
        (!path || (path.endsWith("/") ? url.pathname.startsWith(path) : url.pathname === path))
      );
    })
  );
}
function allowsHash(list, hash) {
  if (!list) return true;
  const lower = list.map((source) => source.toLowerCase());
  return (
    list.includes(`'sha256-${hash}'`) ||
    (lower.includes("'unsafe-inline'") &&
      !lower.some((source) => /^'(nonce-|sha(256|384|512)-|strict-dynamic')/.test(source)))
  );
}

async function checkPages() {
  const assets = new Map();
  const blocked = new Map();
  let inlineChecked = 0;
  const add = (href, base, kind, from) => {
    const url = href ? safeUrl(href, base) : null;
    if (!url || url.origin !== SITE) return;
    url.hash = "";
    if (!assets.has(url.href)) assets.set(url.href, { kind, from });
  };
  const scan = (res, from) => {
    const html = res.text.replace(/<!--[\s\S]*?-->/g, "");
    const found = tags(html);
    for (const { name, attrs } of found) {
      const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
      if (name === "link") {
        if (rel.includes("stylesheet")) add(attrs.href, res.url, "style", from);
        else if (rel.some((value) => value.endsWith("icon")))
          add(attrs.href, res.url, "image", from);
        else if (rel.includes("preload")) add(attrs.href, res.url, attrs.as, from);
      }
      if (name === "script") add(attrs.src, res.url, "script", from);
      if (name === "img") add(attrs.src, res.url, "image", from);
      if (name === "img" || name === "source")
        for (const candidate of (attrs.srcset ?? "").split(","))
          add(candidate.trim().split(/\s+/)[0], res.url, "image", from);
    }
    const csp = res.headers.get("content-security-policy");
    for (const script of csp ? inlineScripts(html) : []) {
      inlineChecked++;
      const hash = createHash("sha256").update(script).digest("base64");
      const directives = ["script-src-elem", "script-src", "default-src"];
      if (!csp.split(",").every((policy) => allowsHash(sources(policy, directives), hash)))
        blocked.set(hash, [...(blocked.get(hash) ?? []), from]);
    }
    return found;
  };

  let home;
  for (const path of PAGES) {
    const res = await send(SITE + path);
    const final = new URL(res.url);
    const ok = res.status === 200 && contentType(res) === "text/html" && final.origin === SITE;
    const via =
      res.url === SITE + path ? "" : ` via ${final.origin === SITE ? final.pathname : res.url}`;
    check(
      `page ${path}`,
      ok,
      res.error ?? `${res.status} ${contentType(res) || "no Content-Type"}${via}`,
    );
    if (!ok) continue;
    if (path === "/") home = res;
    for (const { name, attrs } of scan(res, path)) {
      const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
      if (name === "link" && rel.includes("canonical")) {
        const target = safeUrl(attrs.href ?? "", res.url);
        check(
          `canonical on ${path}`,
          target?.origin === SITE,
          target?.origin === SITE ? attrs.href : `${attrs.href} is not on ${SITE}`,
        );
      }
      if (name === "meta" && attrs.property?.toLowerCase() === "og:image") {
        const content = attrs.content ?? "";
        if (!/^https?:\/\//i.test(content))
          warn(
            `og:image on ${path}`,
            `"${content}" is relative; link previews need an absolute URL`,
          );
        else if (safeUrl(content)?.origin === SITE) check(`og:image on ${path}`, true, content);
        else warn(`og:image on ${path}`, `${content} is on another origin`);
        add(content, res.url, "image", path);
      }
    }
  }

  const missing = `${SITE}/verify-missing-${stamp}/page`;
  const notFound = await send(missing);
  if (notFound.status === 404) {
    check("404 page", true, `404 ${contentType(notFound) || "no Content-Type"}`);
    if (contentType(notFound) === "text/html") scan(notFound, "the 404 page");
  } else
    check(
      "404 page",
      false,
      notFound.status === 200
        ? `${new URL(missing).pathname} answers 200, not 404; without website/404.html, Cloudflare Pages serves index.html for unknown paths`
        : describe(notFound),
    );

  if (home) {
    const nosniff = home.headers.get("x-content-type-options");
    check(
      "X-Content-Type-Options",
      nosniff?.toLowerCase() === "nosniff",
      nosniff ?? "missing; website/_headers sets it",
    );
    const csp = home.headers.get("content-security-policy");
    check(
      "Content-Security-Policy",
      Boolean(csp),
      csp ? "set" : "missing; website/_headers sets it",
    );
    if (csp) {
      const blocking = csp
        .split(",")
        .map((policy) => sources(policy, ["connect-src", "default-src"]))
        .find((list) => !allowsUrl(list, ENDPOINT));
      check(
        "CSP connect-src",
        !blocking,
        blocking
          ? `"${blocking.join(" ")}" blocks ${api.origin}, so the forms can't reach the API`
          : `allows ${api.origin}`,
      );
    }
    const referrer = home.headers.get("referrer-policy");
    if (referrer) check("Referrer-Policy", true, referrer);
    else warn("Referrer-Policy", "missing");
  }
  if (inlineChecked)
    check(
      "CSP inline scripts",
      !blocked.size,
      blocked.size
        ? `${[...blocked].map(([hash, pages]) => `'sha256-${hash}' (${pages.join(", ")})`).join("; ")} not allowed by script-src; update the hashes in website/_headers`
        : `${plural(inlineChecked, "inline script")} allowed by hash`,
    );

  let broken = 0;
  for (const [href, { kind, from }] of assets) {
    const res = await send(href);
    const type = contentType(res);
    const pathname = new URL(href).pathname;
    const [, , expected] =
      KINDS.find(([, extension]) => extension.test(pathname)) ??
      KINDS.find(([name]) => name === kind) ??
      [];
    if (res.status !== 200 || (expected && !expected.test(type))) {
      broken++;
      check(
        `asset ${pathname}`,
        false,
        `${res.error ?? `${res.status} ${type || "no Content-Type"}`} (from ${from})`,
      );
    } else if (type === "text/css")
      for (const [, , ref] of res.text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g))
        if (!/^(data:|#)/i.test(ref.trim())) add(ref.trim(), res.url, undefined, pathname);
  }
  if (!broken)
    check("assets", true, `${assets.size} same-origin files load with plausible content types`);

  if (loopbackSite) warn("http redirects to https", "skipped for a loopback site");
  else {
    const from = `http://${site.hostname}/`;
    const res = await send(from, { redirect: "manual" });
    const location = res.headers.get("location");
    check(
      "http redirects to https",
      [301, 302, 307, 308].includes(res.status) && safeUrl(location, from)?.origin === SITE,
      res.error ?? `${res.status} ${location ? `to ${location}` : "without a Location"}`,
    );
  }
  if (args.www && loopbackSite) warn("www redirect", "skipped for a loopback site");
  else if (args.www) {
    const from = `https://www.${site.host}/verify-path?x=1`;
    const expected = `${SITE}/verify-path?x=1`;
    const res = await send(from, { redirect: "manual" });
    const location = res.headers.get("location");
    const ok = [301, 308].includes(res.status) && safeUrl(location, from)?.href === expected;
    check(
      "www redirect",
      ok,
      `${res.error ?? `${res.status} ${location ? `to ${location}` : "without a Location"}`}${ok ? "" : `; expected 301 or 308 to ${expected}`}`,
    );
  }

  const script = await send(`${SITE}/assets/site.js`);
  const config = /SITE_CONFIG\s*=[^{]*\{([^}]*)\}/.exec(script.text)?.[1];
  if (script.status !== 200 || config === undefined) {
    check(
      "site.js SITE_CONFIG",
      false,
      script.status === 200 ? "SITE_CONFIG not found in /assets/site.js" : describe(script),
    );
    return;
  }
  const value = (key) =>
    new RegExp(`["']?${key}["']?\\s*:\\s*(["'\`])(.*?)\\1`).exec(config)?.[2] ?? "";
  const signupUrl = value("betaSignupUrl");
  check(
    "site.js betaSignupUrl",
    signupUrl === ENDPOINT,
    signupUrl === ENDPOINT
      ? signupUrl
      : signupUrl
        ? `"${signupUrl}", expected ${ENDPOINT}`
        : `empty, expected ${ENDPOINT}; the forms stay closed`,
  );
  const contact = value("contactEmail");
  const contactOk = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(contact);
  check(
    "site.js contactEmail",
    contactOk,
    contactOk
      ? contact
      : `${contact ? `"${contact}" is not an address` : "empty"}; the forms stay closed until it is set`,
  );
}

async function checkApi() {
  // Browsers can't follow a redirected preflight, so a redirect here is a failure, not a hop.
  const call = (init) => send(ENDPOINT, { redirect: "manual", ...init });
  const post = (from, payload) =>
    call({
      method: "POST",
      headers: { Origin: from, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  const preflight = (from) =>
    call({
      method: "OPTIONS",
      headers: {
        Origin: from,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
  const allowedOrigin = (res) => res.headers.get("access-control-allow-origin");
  const tokens = (res, name) =>
    (res.headers.get(name) ?? "")
      .toLowerCase()
      .split(",")
      .map((token) => token.trim());
  const expect = (name, res, ok) => check(name, ok, ok ? describe(res) : explain(res));

  let res = await preflight(SITE);
  let ok =
    res.status === 204 &&
    allowedOrigin(res) === SITE &&
    tokens(res, "access-control-allow-methods").includes("post") &&
    tokens(res, "access-control-allow-headers").some((name) =>
      ["content-type", "*"].includes(name),
    );
  check(
    "API preflight from the site",
    ok,
    ok
      ? `204, allows POST from ${SITE}`
      : res.status === 204
        ? `Allow-Origin ${allowedOrigin(res) ?? "missing"}, Allow-Methods ${res.headers.get("access-control-allow-methods") ?? "missing"}, Allow-Headers ${res.headers.get("access-control-allow-headers") ?? "missing"}`
        : explain(res),
  );
  res = await preflight(OTHER_ORIGIN);
  expect(
    "API preflight from another origin",
    res,
    res.status === 403 && res.json.error === "origin_not_allowed",
  );
  res = await post(OTHER_ORIGIN, { email, company: "" });
  expect(
    "API POST from another origin",
    res,
    res.status === 403 && res.json.error === "origin_not_allowed",
  );
  res = await call({ headers: { Origin: SITE } });
  expect("API GET", res, res.status === 405);
  // The Worker counts signup attempts per calendar minute. Near the end of one, start in the next,
  // so the count can't reset between the fifth attempt and the sixth, which should get the 429.
  const wait = 62_000 - (Date.now() % 60_000);
  if (args["rate-limit"] && wait < 12_000) {
    console.log(
      `Waiting ${Math.ceil(wait / 1000)} s so the rate limit test starts in a fresh minute`,
    );
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  res = await post(SITE, { email: "not-an-email", company: "" });
  expect("API invalid email", res, res.status === 400 && res.json.error === "invalid_email");
  res = await post(SITE, { email: honeypot, company: "Acme" });
  expect("API honeypot", res, res.status === 200 && res.json.ok === true);
  res = await post(SITE, { email, company: "" });
  ok = res.status === 200 && res.json.ok === true && allowedOrigin(res) === SITE;
  check(
    "API signup",
    ok,
    ok
      ? `200 ok for ${email}`
      : res.status === 200
        ? `Access-Control-Allow-Origin is ${allowedOrigin(res) ?? "missing"}, expected ${SITE}`
        : explain(res),
  );
  res = await post(SITE, { email: `  ${email.toUpperCase()}  `, company: "" });
  expect("API duplicate signup", res, res.status === 200 && res.json.ok === true);

  if (!args["rate-limit"]) {
    warn(
      "API rate limit",
      "not tested; --rate-limit tests it and blocks this network for a minute",
    );
    return;
  }
  let tries = 0;
  do {
    res = await post(SITE, { email: "not-an-email", company: "" });
    tries++;
  } while (res.status === 400 && res.json.error === "invalid_email" && tries < 6);
  ok = res.status === 429 && res.json.error === "rate_limited";
  check(
    "API rate limit",
    ok,
    ok
      ? `429 after ${plural(tries, "more attempt")}; this network is blocked from signing up for about a minute`
      : res.status === 400
        ? `no 429 after ${plural(tries, "more attempt")}; rerun in a minute, and if it repeats, the rate limit isn't working`
        : explain(res),
  );
}

console.log(`Checking ${args["skip-pages"] ? "" : `${SITE} and `}${ENDPOINT} with ${email}`);
if (!args["skip-pages"]) await checkPages();
else if (args.www) warn("www redirect", "skipped with --skip-pages");
await checkApi();

console.log(
  `\nSummary: ${counts.PASS} passed, ${counts.FAIL} failed, ${plural(counts.WARN, "warning")}`,
);
const d1 = (sql) =>
  `npx wrangler d1 execute ${args.database ?? "<database>"} --remote --command "${sql}"`;
// Matching lower(trim(email)) also finds a row stored from the duplicate check's upper-case,
// padded address, which would mean the Worker stopped normalizing addresses.
console.log(`\nFrom billing/, confirm D1 holds exactly one row, ${email}, and no honeypot row:`);
console.log(
  d1(
    `SELECT email, datetime(created_at / 1000, 'unixepoch') AS joined FROM beta_signups WHERE lower(trim(email)) IN ('${email}', '${honeypot}')`,
  ),
);
console.log("Then delete the synthetic row:");
console.log(d1(`DELETE FROM beta_signups WHERE lower(trim(email)) = '${email}'`));
process.exitCode = counts.FAIL ? 1 : 0;
