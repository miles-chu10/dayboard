import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createDemoState, demoMeetings, reduceDemo } from "../website/assets/demo-state.js";

class DemoElement {
  constructor(tagName, namespaceURI) {
    this.tagName = tagName;
    this.namespaceURI = namespaceURI;
    this.children = [];
    this.className = "";
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.scrollTop = 0;
    this.text = "";
  }
  set textContent(value) {
    this.text = value;
    this.children = [];
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  append(...children) {
    this.children.push(...children);
  }
  replaceChildren(...children) {
    this.text = "";
    this.children = children;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }
  querySelectorAll(selector) {
    assert.equal(selector, "[data-key]");
    return descendants(this).filter((node) => node.dataset.key !== undefined);
  }
  focus() {}
  click() {
    for (const listener of this.listeners.get("click") ?? []) listener({ target: this });
  }
}

function descendants(root) {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function find(root, className, text) {
  const node = descendants(root).find(
    (item) => item.className.split(" ").includes(className) && item.textContent.includes(text),
  );
  assert.ok(node, `Missing ${className}: ${text}`);
  return node;
}

function renderDemo(source) {
  const root = new DemoElement("div");
  const document = {
    querySelector: (selector) => (selector === "[data-demo]" ? root : null),
    createElement: (tag) => new DemoElement(tag),
    createElementNS: (namespace, tag) => new DemoElement(tag, namespace),
  };
  runInNewContext(source.replace(/^import[^\n]+\n/, ""), {
    document,
    createDemoState,
    demoMeetings,
    reduceDemo,
  });
  return root;
}

test("Home opens an inbox message after visiting the Later folder", () => {
  const source = readFileSync(new URL("../website/assets/demo.js", import.meta.url), "utf8");
  const root = renderDemo(source);
  find(root, "demo-nav-button", "Inbox").click();
  find(root, "demo-segment", "Later").click();
  assert.equal(find(root, "demo-segment", "Later").attributes.get("aria-pressed"), "true");
  find(root, "demo-nav-button", "Home").click();
  find(root, "demo-needs-row", "Priya Shah").click();
  assert.equal(find(root, "demo-segment", "Inbox").attributes.get("aria-pressed"), "true");
  assert.ok(find(root, "demo-mail-detail", "Launch announcement — final copy?"));
  assert.ok(find(root, "demo-mail-detail", "The launch copy is ready for a final pass."));
});
