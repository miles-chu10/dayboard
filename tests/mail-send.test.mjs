import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { createOutbox } = await loadTs("main/services/mail-outbox.ts");
const { buildRawMessage, parseRecipients, replySubject } = await loadTs(
  "main/services/mail-compose.ts",
);

function fakeTimers() {
  let now = 1_000;
  let next = 1;
  const pending = new Map();
  return {
    timers: {
      setTimeout: (callback, ms) => {
        const handle = next++;
        pending.set(handle, { at: now + ms, callback });
        return handle;
      },
      clearTimeout: (handle) => pending.delete(handle),
      now: () => now,
    },
    advance(ms) {
      now += ms;
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(handle);
          timer.callback();
        }
      }
    },
    pending: () => pending.size,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("a held email sends when its undo window ends", async () => {
  const clock = fakeTimers();
  const sent = [];
  const results = [];
  const outbox = createOutbox({
    send: async (payload) => void sent.push(payload),
    onResult: (id, result) => results.push([id, result]),
    timers: clock.timers,
  });
  const ticket = outbox.queue("hello", 5000);
  assert.equal(ticket.sendAt, 6000);
  assert.equal(ticket.sent, undefined);
  clock.advance(4999);
  await settle();
  assert.deepEqual(sent, []);
  clock.advance(1);
  await settle();
  assert.deepEqual(sent, ["hello"]);
  assert.deepEqual(results, [[ticket.id, { ok: true }]]);
});

test("Undo stops a held email, and only once", async () => {
  const clock = fakeTimers();
  const sent = [];
  const outbox = createOutbox({
    send: async (payload) => void sent.push(payload),
    onResult: () => {},
    timers: clock.timers,
  });
  const ticket = outbox.queue("draft", 5000);
  assert.equal(outbox.cancel(ticket.id), true);
  assert.equal(outbox.cancel(ticket.id), false);
  clock.advance(10_000);
  await settle();
  assert.deepEqual(sent, []);
  assert.equal(clock.pending(), 0);
});

test("Undo after the email went reports it can't stop it", async () => {
  const clock = fakeTimers();
  const outbox = createOutbox({ send: async () => {}, onResult: () => {}, timers: clock.timers });
  const ticket = outbox.queue("late", 1000);
  clock.advance(1000);
  await settle();
  assert.equal(outbox.cancel(ticket.id), false);
});

test("quitting sends every held email instead of dropping it", async () => {
  const clock = fakeTimers();
  const sent = [];
  const outbox = createOutbox({
    send: async (payload) => {
      await settle();
      sent.push(payload);
    },
    onResult: () => {},
    timers: clock.timers,
  });
  outbox.queue("one", 5000);
  outbox.queue("two", 20_000);
  await outbox.drain();
  assert.deepEqual(sent.sort(), ["one", "two"]);
  assert.equal(outbox.held(), 0);
  assert.equal(clock.pending(), 0);
});

test("no undo window sends at once and returns the failure", async () => {
  const outbox = createOutbox({
    send: async () => {
      throw new Error("Gmail said no");
    },
    onResult: () => {},
  });
  const ticket = outbox.queue("now", 0);
  assert.deepEqual(await ticket.sent, { ok: false, error: "Gmail said no" });
});

function decode(raw) {
  return Buffer.from(raw, "base64url").toString("utf8");
}

test("recipients accept plain and named addresses and reject the rest", () => {
  assert.deepEqual(parseRecipients("a@x.com, Sam Patel <sam@y.org>; b@z.co", "To"), [
    "a@x.com",
    '"Sam Patel" <sam@y.org>',
    "b@z.co",
  ]);
  assert.match(parseRecipients("Zoë <z@x.com>", "To")[0], /^=\?UTF-8\?B\?.+\?= <z@x\.com>$/);
  assert.throws(() => parseRecipients("not an address", "To"), /To: “not an address” isn't/);
  assert.throws(() => parseRecipients("a@x.com\r\nBcc: evil@x.com", "To"), /isn't an email/);
  assert.throws(
    () => parseRecipients(Array.from({ length: 51 }, (_, i) => `u${i}@x.com`).join(","), "Cc"),
    /at most 50/,
  );
});

test("a reply carries threading headers and can't inject headers through its subject", () => {
  const message = decode(
    buildRawMessage({
      to: ["Sam <sam@y.org>"],
      cc: ["a@x.com"],
      subject: "Lunch\r\nBcc: evil@x.com",
      body: "Sounds good.\nSee you.",
      inReplyTo: "<abc@mail>",
      references: "<root@mail> <abc@mail>",
    }),
  );
  const [head, body] = message.split("\r\n\r\n");
  assert.deepEqual(head.split("\r\n"), [
    "To: Sam <sam@y.org>",
    "Cc: a@x.com",
    "Subject: Lunch Bcc: evil@x.com",
    "In-Reply-To: <abc@mail>",
    "References: <root@mail> <abc@mail>",
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
  ]);
  assert.equal(body, "Sounds good.\r\nSee you.");
  assert.equal(replySubject("Lunch"), "Re: Lunch");
  assert.equal(replySubject("RE: Lunch"), "RE: Lunch");
});

test("a new email needs a recipient and encodes a non-ASCII subject", () => {
  assert.throws(() => buildRawMessage({ to: [], subject: "x", body: "y" }), /recipient/);
  const message = decode(buildRawMessage({ to: ["a@x.com"], subject: "Café", body: "Hi" }));
  assert.match(message, /^To: a@x\.com\r\nSubject: =\?UTF-8\?B\?Q2Fmw6k=\?=\r\n/);
});

// The handler, with Gmail, settings and the platform replaced.
const sentRaw = [];
const broadcasts = [];
const handlers = new Map();
globalThis.__mailFixture = { demo: false, undoSeconds: 0 };
const stubs = {
  name: "mail-stubs",
  setup(build) {
    const map = {
      "../platform/index.js": `export const ipcMain = {
        handle: (channel, fn) => globalThis.__mailHandlers.set(channel, fn),
        broadcast: (channel, params) => globalThis.__mailBroadcasts.push([channel, params]),
      };
      export const logger = { info() {}, warn() {}, error() {} };
      export const app = { getPath: () => "/nonexistent" };`,
      "../services/file-store.js": `export const readFileIfExists = async () => globalThis.__mailFile ?? null;
      export const writeFileAtomic = async (_path, text) => { globalThis.__mailFile = Buffer.from(text); };`,
      "./productivity.js": `export const requireAgendaScope = async () => "google:test";
      export const getAccountsStatus = async () => ({ google: { email: "me@example.com" } });
      export const onAccountsChanged = () => () => {};`,
      "../services/demo-data.js": `export const assertNotDemo = (channel) => {
        if (globalThis.__mailFixture.demo) throw new Error(channel + ": changes are turned off in demo mode.");
      };
      export const isDemoMode = () => globalThis.__mailFixture.demoData !== false;
      export const demoSubscriptionMessages = () => [];`,
      "../services/google-api.js": `export const getReplyContext = async (id) => ({
        to: "Sam Patel <sam@y.org>", subject: "Lunch today?", messageId: "<m-" + id + "@mail>",
        references: "<m-" + id + "@mail>", threadId: "t-" + id,
      });
      export const sendRawMessage = async (raw, threadId) => {
        globalThis.__mailSent.push([raw, threadId]);
        return { id: "sent", threadId: threadId ?? "new" };
      };
      export const modifyMessage = async (id, remove, add = []) => {
        globalThis.__mailModified.push([id, remove, add]);
      };
      export const threadHasReplyAfter = async () => false;
      export const listSubscriptionMessages = async () => globalThis.__mailSubscriptions ?? [];`,
      "../services/settings-store.js": `export const getSettings = async () => ({
        mail: { undoSendSeconds: globalThis.__mailFixture.undoSeconds },
      });`,
      "../services/pending-writes.js": "export const trackPendingWrite = (run) => run();",
    };
    build.onResolve({ filter: /.*/ }, (args) =>
      map[args.path] ? { path: args.path, namespace: "mail-stub" } : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "mail-stub" }, (args) => ({
      contents: map[args.path],
      loader: "js",
    }));
  },
};
globalThis.__mailHandlers = handlers;
globalThis.__mailBroadcasts = broadcasts;
globalThis.__mailSent = sentRaw;
const modified = [];
globalThis.__mailModified = modified;
const mail = await loadTs("main/handlers/mail.ts", [stubs]);
mail.registerMailHandlers();
const invoke = (channel, payload) => handlers.get(channel)({}, payload);

test("mail:send validates before anything is queued", async () => {
  await assert.rejects(invoke("mail:send", null), /expected an object/);
  await assert.rejects(invoke("mail:send", { kind: "forward", body: "x" }), /"kind"/);
  await assert.rejects(invoke("mail:send", { kind: "new", to: "", body: "x" }), /recipient/);
  await assert.rejects(
    invoke("mail:send", { kind: "new", to: "a@x.com", body: "  " }),
    /Write a message/,
  );
  await assert.rejects(
    invoke("mail:send", { kind: "reply", id: "m1", body: "hi", cc: "nope" }),
    /Cc: “nope”/,
  );
  await assert.rejects(invoke("mail:send", { kind: "reply", body: "hi" }), /"id" is required/);
  assert.equal(sentRaw.length, 0);
});

test("demo mode refuses to send", async () => {
  globalThis.__mailFixture.demo = true;
  try {
    await assert.rejects(
      invoke("mail:send", { kind: "new", to: "a@x.com", subject: "s", body: "b" }),
      /demo mode/,
    );
  } finally {
    globalThis.__mailFixture.demo = false;
  }
});

test("a reply sends in its thread to the original sender", async () => {
  const ticket = await invoke("mail:send", { kind: "reply", id: "m6", body: "See you at 12:30" });
  assert.equal(ticket.held, false);
  const [raw, threadId] = sentRaw.at(-1);
  assert.equal(threadId, "t-m6");
  const message = decode(raw);
  assert.match(message, /^To: Sam Patel <sam@y\.org>\r\n/);
  assert.match(message, /\r\nSubject: Re: Lunch today\?\r\n/);
  assert.match(message, /\r\nIn-Reply-To: <m-m6@mail>\r\n/);
  assert.ok(broadcasts.some(([channel]) => channel === "data:changed"));
});

test("with an undo window the email is held and Undo cancels it", async () => {
  globalThis.__mailFixture.undoSeconds = 5;
  try {
    const before = sentRaw.length;
    const ticket = await invoke("mail:send", {
      kind: "new",
      to: "a@x.com",
      subject: "Hi",
      body: "Hello",
    });
    assert.equal(ticket.held, true);
    assert.ok(ticket.sendAt > Date.now() + 4000);
    assert.deepEqual(await invoke("mail:cancelSend", { id: ticket.id }), { cancelled: true });
    assert.deepEqual(await invoke("mail:cancelSend", { id: ticket.id }), { cancelled: false });
    await mail.drainMailOutbox();
    assert.equal(sentRaw.length, before);
  } finally {
    globalThis.__mailFixture.undoSeconds = 0;
  }
});

const lunch = {
  messageId: "m6",
  threadId: "t6",
  subject: "Lunch today?",
  from: "Sam Patel",
  fromEmail: "sam@y.org",
};

test("snoozing archives the email and records when it comes back", async () => {
  await assert.rejects(invoke("mail:snooze", { ...lunch, until: Date.now() }), /future/);
  await assert.rejects(
    invoke("mail:snooze", { ...lunch, until: Date.now() + 400 * 86_400_000 }),
    /at most a year/,
  );
  await assert.rejects(
    invoke("mail:snooze", { ...lunch, messageId: "", until: Date.now() + 3_600_000 }),
    /"messageId"/,
  );
  const until = Date.now() + 3_600_000;
  const entry = await invoke("mail:snooze", { ...lunch, until });
  assert.deepEqual(modified.at(-1), ["m6", ["INBOX"], []]);
  assert.equal(entry.kind, "snooze");
  assert.equal(entry.dueAt, until);
  const listed = await invoke("mail:schedule");
  assert.deepEqual(
    listed.map((item) => [item.kind, item.messageId]),
    [["snooze", "m6"]],
  );
  assert.ok(broadcasts.some(([channel]) => channel === "mail:scheduleChanged"));

  await invoke("mail:unsnooze", { messageId: "m6" });
  assert.deepEqual(modified.at(-1), ["m6", [], ["INBOX"]]);
  assert.deepEqual(await invoke("mail:schedule"), []);
});

test("follow-ups take 1 to 30 days and can be cancelled", async () => {
  await assert.rejects(invoke("mail:followUp", { ...lunch, days: 0 }), /1 to 30/);
  await assert.rejects(invoke("mail:followUp", { ...lunch, days: 2.5 }), /1 to 30/);
  const entry = await invoke("mail:followUp", { ...lunch, days: 3 });
  assert.equal(entry.kind, "follow-up");
  assert.ok(Math.abs(entry.dueAt - entry.createdAt - 3 * 86_400_000) < 1000);
  assert.deepEqual(await invoke("mail:cancelFollowUp", { messageId: "m6" }), { removed: true });
  assert.deepEqual(await invoke("mail:cancelFollowUp", { messageId: "m6" }), { removed: false });
});

test("demo mode refuses to snooze, since that changes Gmail", async () => {
  globalThis.__mailFixture.demo = true;
  try {
    await assert.rejects(
      invoke("mail:snooze", { ...lunch, until: Date.now() + 3_600_000 }),
      /demo mode/,
    );
  } finally {
    globalThis.__mailFixture.demo = false;
  }
});

const newsletter = (fromEmail, overrides = {}) => ({
  from: fromEmail.split("@")[0],
  fromEmail,
  listUnsubscribe: "",
  listUnsubscribePost: "",
  unread: false,
  date: Date.now(),
  ...overrides,
});

test("subscriptions unsubscribe by one-click POST, then by email, then in the browser", async () => {
  globalThis.__mailFixture.demoData = false;
  const realFetch = globalThis.fetch;
  const posts = [];
  globalThis.fetch = async (url, init) => {
    posts.push([String(url), init.method, init.body]);
    return new Response(null, { status: 200 });
  };
  try {
    globalThis.__mailSubscriptions = [
      newsletter("news@one.example", {
        listUnsubscribe: "<https://one.example/u?id=1>, <mailto:u@one.example>",
        listUnsubscribePost: "List-Unsubscribe=One-Click",
      }),
      newsletter("list@two.example", {
        listUnsubscribe: "<mailto:leave@two.example?subject=stop>",
      }),
      newsletter("deals@three.example", { listUnsubscribe: "<https://three.example/prefs>" }),
      newsletter("friend@example.com"),
    ];
    const { subscriptions } = await invoke("mail:subscriptions", { refresh: true });
    assert.deepEqual(
      subscriptions.map((item) => item.email),
      ["news@one.example", "list@two.example", "deals@three.example"],
    );

    assert.deepEqual(await invoke("mail:unsubscribe", { email: "news@one.example" }), {
      method: "one-click",
    });
    assert.deepEqual(posts, [["https://one.example/u?id=1", "POST", "List-Unsubscribe=One-Click"]]);

    const before = sentRaw.length;
    assert.deepEqual(await invoke("mail:unsubscribe", { email: "list@two.example" }), {
      method: "email",
    });
    assert.match(
      decode(sentRaw.slice(before)[0][0]),
      /^To: leave@two\.example\r\nSubject: stop\r\n/,
    );

    assert.deepEqual(await invoke("mail:unsubscribe", { email: "deals@three.example" }), {
      method: "browser",
      url: "https://three.example/prefs",
    });
    // Unsubscribed senders leave the list; a page to finish in the browser keeps its row.
    const after = await invoke("mail:subscriptions");
    assert.deepEqual(
      after.subscriptions.map((item) => item.email),
      ["deals@three.example"],
    );
    await assert.rejects(invoke("mail:unsubscribe", { email: "nobody@x.com" }), /Refresh/);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.__mailFixture.demoData = undefined;
  }
});

test("a one-click link to this Mac's network falls back to the unsubscribe email", async () => {
  globalThis.__mailFixture.demoData = false;
  const realFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return new Response(null, { status: 200 });
  };
  try {
    globalThis.__mailSubscriptions = [
      newsletter("sneaky@example.com", {
        listUnsubscribe: "<https://192.168.1.1/unsub>, <mailto:leave@example.com>",
        listUnsubscribePost: "List-Unsubscribe=One-Click",
      }),
    ];
    await invoke("mail:subscriptions", { refresh: true });
    assert.deepEqual(await invoke("mail:unsubscribe", { email: "sneaky@example.com" }), {
      method: "email",
    });
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.__mailFixture.demoData = undefined;
  }
});

test("a one-click link that redirects falls back instead of following it", async () => {
  globalThis.__mailFixture.demoData = false;
  const realFetch = globalThis.fetch;
  const redirects = [];
  globalThis.fetch = async (_url, init) => {
    redirects.push(init.redirect);
    // Followed, this redirect would POST to the Mac's own network; the fetch must not follow.
    if (init.redirect !== "manual") return new Response(null, { status: 200 });
    return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:3000/" } });
  };
  try {
    globalThis.__mailSubscriptions = [
      newsletter("bounce@example.com", {
        listUnsubscribe: "<https://public.example/unsub>, <mailto:leave@example.com>",
        listUnsubscribePost: "List-Unsubscribe=One-Click",
      }),
    ];
    await invoke("mail:subscriptions", { refresh: true });
    assert.deepEqual(await invoke("mail:unsubscribe", { email: "bounce@example.com" }), {
      method: "email",
    });
    assert.deepEqual(redirects, ["manual"]);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.__mailFixture.demoData = undefined;
  }
});

test("demo mode lists sample subscriptions but never unsubscribes", async () => {
  globalThis.__mailFixture.demo = true;
  try {
    await assert.rejects(invoke("mail:unsubscribe", { email: "news@one.example" }), /demo mode/);
  } finally {
    globalThis.__mailFixture.demo = false;
  }
});
