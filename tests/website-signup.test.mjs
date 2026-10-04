import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../website/assets/site.js", import.meta.url), "utf8");
const endpoint = "https://api.getdayboard.com/v1/waitlist";
const address = "visitor@example.test";
const FAILED = "Something went wrong on our side. Try again in a moment.";
const OFFLINE = "Couldn't reach the waitlist. Check your connection and try again.";
const TIMEOUT = "The waitlist didn't answer in time. Check your connection and try again.";

// Runs the real site script against a minimal stand-in for a page with signup forms. Timers are
// recorded rather than scheduled, so a test can expire the request timeout itself.
function page(fetch, { forms = 1, script = source } = {}) {
  const timers = new Map();
  let focused = null;
  const node = (fields = {}) => {
    const element = {
      dataset: {},
      textContent: "",
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      focus() {
        focused = element;
      },
      ...fields,
    };
    return element;
  };
  const views = Array.from({ length: forms }, () => {
    const input = node({
      value: "",
      disabled: true,
      checkValidity() {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value.trim());
      },
    });
    const button = node({ textContent: "Join the waitlist", disabled: true });
    const status = node();
    const note = node();
    const parts = {
      'input[type="email"]': input,
      'button[type="submit"]': button,
      ".signup-status": status,
      ".signup-note": note,
    };
    let onSubmit;
    const form = node({
      children: [],
      elements: { company: { value: "" } },
      querySelector: (selector) => parts[selector],
      addEventListener: (type, listener) => {
        if (type === "submit") onSubmit = listener;
      },
      replaceChildren(...children) {
        this.children = children;
      },
    });
    return { form, input, button, status, note, submit: () => onSubmit({ preventDefault() {} }) };
  });
  let lastTimer = 0;
  vm.runInNewContext(script, {
    document: {
      createElement: () => node({ className: "", innerHTML: "" }),
      querySelector: () => null,
      querySelectorAll: (selector) =>
        selector === "form[data-signup]" ? views.map((view) => view.form) : [],
    },
    window: { scrollY: 0, addEventListener() {} },
    location: { hostname: "getdayboard.com" },
    fetch,
    AbortController,
    setTimeout: (callback, ms) => {
      timers.set(++lastTimer, { callback, ms });
      return lastTimer;
    },
    clearTimeout: (id) => timers.delete(id),
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    URL,
  });
  return { ...views[0], views, timers, focused: () => focused };
}

// After any failure the form is usable again, with the address kept for another try.
function assertRetryable(view) {
  assert.equal(view.input.disabled, false);
  assert.equal(view.input.value, address);
  assert.equal(view.button.disabled, false);
  assert.equal(view.button.textContent, "Join the waitlist");
  assert.equal(view.form.attributes["aria-busy"], undefined);
  assert.equal(view.focused(), view.input);
  assert.equal(view.timers.size, 0);
}

test("joins only on the API's success answer, posting the trimmed address to the waitlist", async () => {
  const requests = [];
  const accept = async (url, init) => {
    requests.push({ url, init });
    return Response.json({ ok: true });
  };
  const view = page(accept, { forms: 2 });
  assert.equal(view.input.disabled, false);
  view.input.value = ` ${address} `;
  await view.submit();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, endpoint);
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), { email: address, company: "" });
  assert.ok(requests[0].init.signal);
  for (const { form } of view.views) {
    assert.match(form.children[0].innerHTML, /You're on the waitlist\./);
    assert.doesNotMatch(form.children[0].innerHTML, /download|beta invite/i);
    assert.equal(form.attributes["aria-busy"], undefined);
  }
  assert.equal(view.focused(), view.form.children[0]);
  assert.equal(view.timers.size, 0);

  const replies = [];
  const concurrent = page(() => new Promise((resolve) => replies.push(resolve)), { forms: 2 });
  const submissions = concurrent.views.map((other) => {
    other.input.value = address;
    return other.submit();
  });
  for (const { form } of concurrent.views) assert.equal(form.attributes["aria-busy"], "true");
  replies[0](Response.json({ ok: true }));
  await submissions[0];
  for (const { form } of concurrent.views) assert.equal(form.attributes["aria-busy"], undefined);
  replies[1](Response.json({ error: "service_unavailable" }, { status: 503 }));
  await submissions[1];
  for (const { form } of concurrent.views) {
    assert.match(form.children[0].innerHTML, /You're on the waitlist\./);
    assert.equal(form.attributes["aria-busy"], undefined);
  }
  assert.equal(concurrent.timers.size, 0);
});

test("treats HTML, malformed and unexpected answers as failures that can be retried", async () => {
  const answers = [
    () => new Response("<!doctype html><title>Just a moment…</title>", { status: 200 }),
    () => new Response("ok", { status: 200 }),
    () => Response.json({ ok: false }),
    () => Response.json({ ok: "true" }),
    () => Response.json({}),
    () => Response.json({ ok: true }, { status: 500 }),
    () => Response.json({ error: "constructor" }, { status: 400 }),
  ];
  for (const answer of answers) {
    const view = page(async () => answer());
    view.input.value = address;
    await view.submit();
    assert.deepEqual(view.form.children, [], String(answer));
    assert.equal(view.status.dataset.tone, "error");
    assert.equal(view.status.textContent, FAILED);
    assertRetryable(view);
  }
});

test("explains rate limits and rejected addresses from the API", async () => {
  for (const [status, error, message] of [
    [429, "rate_limited", /Too many tries/],
    [400, "invalid_email", /doesn't look right/],
    [503, "service_unavailable", /went wrong on our side/],
  ]) {
    const view = page(async () => Response.json({ error }, { status }));
    view.input.value = address;
    await view.submit();
    assert.match(view.status.textContent, message);
    assertRetryable(view);
  }
});

test("network failures and timeouts leave a working retry, and a busy form ignores resubmits", async () => {
  let attempts = 0;
  const flaky = (url, init) => {
    attempts++;
    if (attempts === 1) return Promise.reject(new TypeError("Failed to fetch"));
    if (attempts === 2) {
      return new Promise((_, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason)),
      );
    }
    return Promise.resolve(Response.json({ ok: true }));
  };
  const view = page(flaky);
  view.input.value = address;
  await view.submit();
  assert.equal(view.status.textContent, OFFLINE);
  assertRetryable(view);

  const pending = view.submit();
  assert.equal(view.button.disabled, true);
  assert.equal(view.form.attributes["aria-busy"], "true");
  await view.submit();
  assert.equal(attempts, 2);
  const [timer] = view.timers.values();
  assert.equal(timer.ms, 15000);
  timer.callback();
  await pending;
  assert.equal(view.status.textContent, TIMEOUT);
  assertRetryable(view);

  await view.submit();
  assert.equal(attempts, 3);
  assert.equal(view.form.attributes["aria-busy"], undefined);
  assert.match(view.form.children[0].innerHTML, /You're on the waitlist\./);
});

test("asks for a valid address without contacting the service", async () => {
  let requests = 0;
  const view = page(async () => {
    requests++;
    return Response.json({ ok: true });
  });
  view.input.value = "not-an-address";
  await view.submit();
  assert.equal(requests, 0);
  assert.equal(view.status.textContent, "Enter a valid email address.");
  assert.equal(view.focused(), view.input);
  assert.equal(view.button.disabled, false);
});

test("keeps the forms closed until the waitlist URL is set", () => {
  const closed = source.replace(/waitlistUrl: "[^"]*"/, 'waitlistUrl: ""');
  assert.notEqual(closed, source);
  const view = page(() => assert.fail("a closed form must not post"), { script: closed });
  assert.equal(view.input.disabled, true);
  assert.equal(view.button.disabled, true);
  assert.equal(view.note.textContent, "The waitlist opens soon. Check back shortly.");
});
