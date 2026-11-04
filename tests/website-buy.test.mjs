import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../website/assets/site.js", import.meta.url), "utf8");

// Runs the real site script with a given buyUrl against stand-ins for the buy button and the
// "checkout isn't open yet" note, and returns them after the script ran.
function run(buyUrl) {
  assert.equal(source.match(/buyUrl: "[^"]*"/g)?.length, 1);
  const script = source.replace(/buyUrl: "[^"]*"/, `buyUrl: ${JSON.stringify(buyUrl)}`);
  const button = { hidden: true, href: undefined };
  const note = { hidden: false };
  const lists = { "a[data-buy]": [button], "[data-buy-pending]": [note] };
  vm.runInNewContext(script, {
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => lists[selector] ?? [],
    },
    window: { scrollY: 0, addEventListener() {} },
    location: { hostname: "getdayboard.com" },
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
    },
    URL,
  });
  return { button, note };
}

test("the shipped site keeps the buy button hidden and says checkout isn't open", () => {
  assert.match(source, /buyUrl: ""/);
  const { button, note } = run("");
  assert.equal(button.hidden, true);
  assert.equal(button.href, undefined);
  assert.equal(note.hidden, false);
});

test("an HTTPS checkout address shows the buy button and hides the note", () => {
  const { button, note } = run("https://api.getdayboard.com/buy");
  assert.equal(button.hidden, false);
  assert.equal(button.href, "https://api.getdayboard.com/buy");
  assert.equal(note.hidden, true);
});

test("a non-HTTPS or malformed checkout address keeps the button hidden", () => {
  for (const url of ["http://api.getdayboard.com/buy", "javascript:alert(1)", "not a url"]) {
    const { button, note } = run(url);
    assert.equal(button.hidden, true, url);
    assert.equal(note.hidden, false, url);
  }
});
