/* global document, getComputedStyle, NodeFilter, innerWidth, innerHeight */
// Runs inside a DayBoard window (see layout-audit.ts). Finds what a person would see as broken:
// text painted over other text or a control, controls something else covers, and controls without
// a name. `stress` first lengthens the listed item strings, the way a pasted URL would.
// The file is one function expression that layout-audit.ts evaluates in the page.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions
({ root: rootSelector, stress }) => {
  const root = (rootSelector && document.querySelector(rootSelector)) || document.body;
  const LONG =
    " https://goldcast.registration.public-pr50.goldcast.io/on-demand/b6b0c3d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9";
  const CONTROL =
    "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=combobox], [role=menuitem], [role=link], [role=slider]";

  if (stress?.length) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = stress.find((item) => node.textContent.includes(item));
      if (text && !node.parentElement.closest("input, textarea, [contenteditable]")) {
        node.textContent = node.textContent.replace(text, text + LONG);
      }
    }
  }

  const visible = (element) => {
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      if (node === root) break;
    }
    return true;
  };
  // What remains of `rect` after every clipping ancestor of `from`, and the viewport.
  const clip = (from, rect) => {
    let { left, top, right, bottom } = rect;
    for (let node = from; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      if (style.overflowX !== "visible") {
        left = Math.max(left, box.left);
        right = Math.min(right, box.right);
      }
      if (style.overflowY !== "visible") {
        top = Math.max(top, box.top);
        bottom = Math.min(bottom, box.bottom);
      }
    }
    left = Math.max(left, 0);
    top = Math.max(top, 0);
    right = Math.min(right, innerWidth);
    bottom = Math.min(bottom, innerHeight);
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
  };
  // Text past its container's right edge is fine when it ends in an ellipsis or can scroll there.
  const shortened = (owner, right) => {
    for (let node = owner; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") return true;
      if (style.overflowX !== "visible" && node.getBoundingClientRect().right < right - 2) {
        return style.overflowX === "auto" || style.overflowX === "scroll";
      }
    }
    return false;
  };
  // The first box a line of text runs past without being clipped, as an unbreakable URL does.
  const spill = (owner, box) => {
    for (let node = owner; node && node !== root.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.position === "absolute" || style.position === "fixed") return null;
      const edge = node.getBoundingClientRect();
      // Boxless (display: contents) wrappers hold nothing; hanging pre-wrap spaces are a few px.
      if (
        style.display !== "contents" &&
        (box.right > edge.right + 6 || box.left < edge.left - 6)
      ) {
        return node;
      }
      if (style.overflowX !== "visible") return null;
    }
    return null;
  };
  const describe = (element) => {
    const label =
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent.trim().replace(/\s+/g, " ");
    return `${element.tagName.toLowerCase()}${element.getAttribute("role") ? `[${element.getAttribute("role")}]` : ""} "${label.slice(0, 60)}"`;
  };

  const issues = new Set();
  const parts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const owner = node.parentElement;
    if (
      !node.textContent.trim() ||
      !owner ||
      owner.closest("[aria-hidden=true]") ||
      !visible(owner)
    ) {
      continue;
    }
    // A truncated title squeezed to a letter or two by its neighbours.
    const style = getComputedStyle(owner);
    if (
      style.textOverflow === "ellipsis" &&
      owner.scrollWidth > owner.clientWidth + 1 &&
      owner.clientWidth < 30
    ) {
      issues.add(`squeezed to ${owner.clientWidth}px: ${describe(owner)}`);
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      const box = clip(owner, rect);
      if (box) parts.push({ kind: "text", element: owner, box });
      if (box && rect.right - box.right > 2 && !shortened(owner, rect.right)) {
        issues.add(`cut off: ${describe(owner)}`);
      }
      const spilled = box && spill(owner, box);
      if (spilled) issues.add(`spills out of ${describe(spilled)}: ${describe(owner)}`);
    }
  }
  const controls = [...root.querySelectorAll(CONTROL)].filter(
    (element) => visible(element) && !element.closest("[aria-hidden=true]"),
  );
  for (const element of controls) {
    const box = clip(element.parentElement, element.getBoundingClientRect());
    if (box) parts.push({ kind: "control", element, box });
  }
  for (const element of root.querySelectorAll("svg, img")) {
    if (element.parentElement.closest("svg") || !visible(element)) continue;
    const box = clip(element.parentElement, element.getBoundingClientRect());
    if (box) parts.push({ kind: "graphic", element, box });
  }

  const opaque = (element) => {
    const color = getComputedStyle(element).backgroundColor;
    const alpha = color.match(/rgba?\(([^)]+)\)/)?.[1].split(/[ ,/]+/)[3];
    return color !== "transparent" && (alpha === undefined || Number(alpha) >= 0.95);
  };
  const painted = (stack, element) => {
    const at = stack.findIndex((node) => element.contains(node));
    return at >= 0 && stack.slice(0, at).every((node) => node.contains(element) || !opaque(node));
  };

  const related = (a, b) => a === b || a.contains(b) || b.contains(a);
  // Text inside a control is part of that control.
  const ownerControl = (part) =>
    part.kind === "control" ? part.element : part.element.closest(CONTROL);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      if (related(a.element, b.element) || (a.kind === "graphic" && b.kind === "graphic")) continue;
      const ca = ownerControl(a);
      const cb = ownerControl(b);
      if (ca && cb && related(ca, cb)) continue;
      const width = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left);
      const height = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (width <= 2 || height <= 2) continue;
      // Only a collision if both are painted there, not one hidden under an opaque layer.
      const x = Math.max(a.box.left, b.box.left) + width / 2;
      const y = Math.max(a.box.top, b.box.top) + height / 2;
      const stack = document.elementsFromPoint(x, y);
      if (!painted(stack, a.element) || !painted(stack, b.element)) continue;
      issues.add(`overlap: ${describe(a.element)} × ${describe(b.element)}`);
    }
  }
  // A control scrolled beneath a sticky header (the Calendar keeps the selected day's row in view
  // under its controls) is out of view, not covered: the header sits below their common ancestor.
  const underSticky = (hit, element) => {
    for (let node = hit; node && !node.contains(element); node = node.parentElement) {
      if (getComputedStyle(node).position === "sticky") return true;
    }
    return false;
  };
  for (const element of controls) {
    const box = clip(element.parentElement, element.getBoundingClientRect());
    if (!box) continue;
    const name =
      element.getAttribute("aria-label") ||
      element.getAttribute("aria-labelledby") ||
      element.getAttribute("title") ||
      element.textContent.trim() ||
      (element.id && document.querySelector(`label[for="${element.id}"]`)) ||
      element.closest("label") ||
      element.getAttribute("placeholder");
    if (!name) issues.add(`unnamed: ${element.outerHTML.slice(0, 120)}`);
    const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    if (
      hit &&
      !element.contains(hit) &&
      !hit.contains(element) &&
      !(hit.closest("label") && hit.closest("label").contains(element)) &&
      !underSticky(hit, element)
    ) {
      issues.add(`covered: ${describe(element)} under ${describe(hit)}`);
    }
  }
  return [...issues];
};
