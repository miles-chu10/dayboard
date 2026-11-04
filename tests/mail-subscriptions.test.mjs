import assert from "node:assert/strict";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const { groupSubscriptions, parseListUnsubscribe, parseMailto, safeOneClickUrl } = await loadTs(
  "main/services/mail-subscriptions.ts",
);

test("List-Unsubscribe headers become one-click, email or browser methods", () => {
  assert.deepEqual(
    parseListUnsubscribe(
      "<mailto:u@x.com?subject=bye>, <https://x.com/u/1>",
      "List-Unsubscribe=One-Click",
    ),
    { oneClick: "https://x.com/u/1", mailto: "mailto:u@x.com?subject=bye" },
  );
  assert.deepEqual(parseListUnsubscribe("<https://x.com/prefs>", ""), {
    url: "https://x.com/prefs",
  });
  // Plain HTTP is never followed.
  assert.deepEqual(parseListUnsubscribe("<http://x.com/u>", "List-Unsubscribe=One-Click"), {});
  assert.deepEqual(parseListUnsubscribe("", ""), {});
});

test("senders group by address with how many of their emails were opened", () => {
  const message = (fromEmail, unread, date, header = "<mailto:leave@list.com>") => ({
    from: "Weekly",
    fromEmail,
    listUnsubscribe: header,
    listUnsubscribePost: "",
    unread,
    date,
  });
  const groups = groupSubscriptions([
    message("news@a.com", true, 1),
    message("NEWS@a.com", false, 3),
    message("news@a.com", true, 2),
    message("solo@b.com", false, 5),
    message("friend@c.com", false, 9, ""),
  ]);
  assert.deepEqual(
    groups.map(({ email, count, opened, lastAt }) => [email, count, opened, lastAt]),
    [
      ["news@a.com", 3, 1, 3],
      ["solo@b.com", 1, 1, 5],
    ],
  );
});

test("one-click URLs must be public HTTPS", () => {
  assert.equal(safeOneClickUrl("https://list.example.com/u?x=1")?.hostname, "list.example.com");
  for (const bad of [
    "http://list.example.com/u",
    "https://localhost/u",
    "https://127.0.0.1/u",
    "https://2130706433/u",
    "https://10.0.0.5/u",
    "https://192.168.1.1/u",
    "https://172.20.0.1/u",
    "https://169.254.169.254/latest",
    "https://[::1]/u",
    "https://printer.local/u",
    "https://user:pass@list.example.com/u",
    "not a url",
  ])
    assert.equal(safeOneClickUrl(bad), null, bad);
});

test("mailto links give a recipient, subject and body, with safe defaults", () => {
  assert.deepEqual(parseMailto("mailto:leave@list.com?subject=Stop%20please&body=bye"), {
    to: "leave@list.com",
    subject: "Stop please",
    body: "bye",
  });
  assert.deepEqual(parseMailto("mailto:leave@list.com"), {
    to: "leave@list.com",
    subject: "unsubscribe",
    body: "unsubscribe",
  });
  assert.equal(parseMailto("mailto:not-an-address"), null);
  assert.equal(parseMailto("mailto:a@b.com%0D%0ABcc:evil@x.com"), null);
  assert.equal(parseMailto("https://x.com"), null);
});
