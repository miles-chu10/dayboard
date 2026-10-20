import assert from "node:assert/strict";
import test from "node:test";

import { notesLines } from "./notes-lines";

test("renders notes as text", () => {
  assert.deepEqual(
    notesLines("# Decisions\n\n- **Ship** it\n- <script>alert(1)</script>\nPlain line"),
    [
      { kind: "heading", text: "Decisions" },
      { kind: "bullet", text: "Ship it" },
      { kind: "bullet", text: "<script>alert(1)</script>" },
      { kind: "text", text: "Plain line" },
    ],
  );
});
