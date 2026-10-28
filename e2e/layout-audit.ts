import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { root } from "./fixtures";

const SCRIPT = readFileSync(path.join(root, "e2e", "layout-audit.browser.js"), "utf8")
  .trim()
  .replace(/;$/, "");

/** Item text from the demo data that people can make arbitrarily long. */
export const DEMO_ITEM_TEXT = [
  "Finalize launch announcement",
  "Review pull request for onboarding",
  "Send Q4 budget to finance",
  "Submit expense report",
  "Follow up with design agency",
  "Call Mom",
  "Pick up dry cleaning",
  "Water the plants",
  "Groceries: oat milk, berries, bread",
  "Design review: onboarding flow",
  "Q4 roadmap sync",
  "Lunch with Sam",
  "Launch announcement — final copy?",
  "Agenda for tomorrow's 1:1",
  "Reminder: Q4 budget due Friday",
  "Priya Shah",
  "Jordan Lee",
  "Personal",
  "Family",
  "Errands",
  "Studio B",
  "Blue Bottle Café",
  "Share draft with Priya before 3 PM",
  "Walk through the new first-run screens and agree on copy",
  "I made a few edits to the headline",
  "Ask for revised timeline",
];

/**
 * Overlapping text, covered controls and unnamed controls in `page` (or the `root` selector). With
 * `stress`, demo item text is first lengthened in place to check long titles and pasted URLs.
 */
export function auditLayout(page: Page, options: { root?: string; stress?: boolean } = {}) {
  return page.evaluate(
    `(${SCRIPT})(${JSON.stringify({
      root: options.root,
      stress: options.stress ? DEMO_ITEM_TEXT : undefined,
    })})`,
  ) as Promise<string[]>;
}
