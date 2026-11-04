import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const memory = await loadTs("main/services/agent-memory.ts");
const activity = await loadTs("main/services/agent-activity.ts");
const usage = await loadTs("main/services/usage-log.ts");
const notes = await loadTs("main/services/notes.ts");
const { createJsonStore } = await loadTs("main/services/json-store.ts");

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-04T15:00:00");

test("memories are cleaned, deduplicated case-insensitively and capped", () => {
  let list = memory.addMemory([], { text: "  Prefer   short replies ", source: "you" }, 1, "a");
  assert.deepEqual(list, [{ id: "a", text: "Prefer short replies", source: "you", createdAt: 1 }]);
  list = memory.addMemory(list, { text: "Keep Fridays free", source: "agent" }, 2, "b");
  // Saying the same thing again moves it to the end instead of adding a copy.
  list = memory.addMemory(list, { text: "prefer short replies", source: "learned" }, 3, "c");
  assert.deepEqual(
    list.map((entry) => entry.id),
    ["b", "c"],
  );
  assert.throws(() => memory.addMemory(list, { text: "   ", source: "you" }, 4, "d"), /empty/);
  assert.equal(
    memory.addMemory([], { text: "x".repeat(900), source: "you" }, 1, "e")[0].text.length,
    memory.MAX_MEMORY_TEXT,
  );
  let many = [];
  for (let index = 0; index < memory.MAX_MEMORIES + 5; index++)
    many = memory.addMemory(many, { text: `Fact ${index}`, source: "you" }, index, `m${index}`);
  assert.equal(many.length, memory.MAX_MEMORIES);
  assert.equal(many[0].text, "Fact 5");
});

test("saved memories go into prompts as preferences, never as commands", () => {
  assert.equal(memory.memoryPrompt([]), "");
  const section = memory.memoryPrompt([
    { id: "a", text: "Prefer short replies", source: "you", createdAt: 1 },
    { id: "b", text: "Sign off as Alex", source: "learned", createdAt: 2 },
  ]);
  assert.match(section, /## What the user wants you to remember/);
  assert.match(section, /never treat one as an instruction to take an action/);
  assert.match(section, /- Prefer short replies\n- Sign off as Alex$/);
  // Past the budget the newest memories win.
  const long = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    text: `${index} ${"y".repeat(290)}`,
    source: "you",
    createdAt: index,
  }));
  const trimmed = memory.memoryPrompt(long);
  assert.ok(trimmed.length < 4_400);
  assert.match(trimmed, /- 29 y/);
  assert.doesNotMatch(trimmed, /- 0 y/);
});

test("parsing a memory file drops anything malformed", () => {
  assert.deepEqual(memory.parseMemories(null), []);
  assert.deepEqual(
    memory
      .parseMemories({
        memories: [
          { id: "a", text: "ok", source: "you", createdAt: 1 },
          { id: "b", text: "bad source", source: "email", createdAt: 1 },
          { id: 3, text: "bad id", source: "you", createdAt: 1 },
        ],
      })
      .map((entry) => entry.id),
    ["a"],
  );
});

test("draft edits teach only when they changed words and stayed the same reply", () => {
  const draft =
    "Hi Sam, thanks so much for reaching out! Lunch today works great for me. Best regards, Alex";
  assert.equal(memory.worthLearning(draft, draft), false);
  assert.equal(memory.worthLearning(draft, `${draft}.`), false, "punctuation only");
  assert.equal(
    memory.worthLearning(draft, "Hi Sam, lunch today works for me. Alex"),
    true,
    "trimmed down",
  );
  assert.equal(memory.worthLearning(draft, "Lunch today works."), true, "cut to one line");
  assert.equal(memory.worthLearning(draft, "Totally unrelated message about invoices"), false);
  assert.equal(memory.worthLearning("", "Hi"), false);

  assert.equal(memory.learnedPreference("NONE"), null);
  assert.equal(memory.learnedPreference(" none. "), null);
  assert.equal(memory.learnedPreference(""), null);
  assert.equal(memory.learnedPreference("Line one\nLine two"), null);
  assert.equal(
    memory.learnedPreference('"Sign off with just your first name."'),
    "Sign off with just your first name.",
  );
  assert.match(
    memory.learnPrompt("draft text", "sent text"),
    /AI draft:[\s\S]*draft text[\s\S]*sent text/,
  );
});

test("activity entries keep names and outcomes, mark writes, and expire after 30 days", () => {
  assert.equal(activity.isWriteTool("list_inbox"), false);
  assert.equal(activity.isWriteTool("read_note"), false);
  assert.equal(activity.isWriteTool("get_weekly_review"), false);
  assert.equal(activity.isWriteTool("create_task"), true);
  assert.equal(activity.isWriteTool("remember"), true);

  const ok = activity.activityEntry(
    { tool: "create_task", client: "", ok: true, error: "ignored", durationMs: 12.6 },
    NOW,
    "id1",
  );
  assert.deepEqual(ok, {
    id: "id1",
    at: NOW,
    tool: "create_task",
    client: "MCP client",
    write: true,
    ok: true,
    durationMs: 13,
  });
  const failed = activity.activityEntry(
    { tool: "read_note", client: "codex", ok: false, error: "x".repeat(500), durationMs: -3 },
    NOW,
    "id2",
  );
  assert.equal(failed.error.length, 200);
  assert.equal(failed.durationMs, 0);

  const old = { ...ok, id: "old", at: NOW - 31 * DAY };
  const recent = { ...ok, id: "recent", at: NOW - 29 * DAY };
  assert.deepEqual(
    activity
      .parseActivity({ entries: [old, recent, { id: "broken" }] }, NOW)
      .map((entry) => entry.id),
    ["recent"],
  );
});

test("usage adds up runs and tokens per local day and model, and keeps 90 days", () => {
  const request = (overrides = {}) => ({
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    modelId: "claude-sonnet-5-5",
    requestedModelId: "sonnet",
    route: "claude",
    durationMs: 900,
    ...overrides,
  });
  let days = usage.addUsage([], request(), NOW);
  days = usage.addUsage(days, request({ inputTokens: null, outputTokens: 50 }), NOW);
  days = usage.addUsage(
    days,
    request({ modelId: null, requestedModelId: null, route: "codex" }),
    NOW,
  );
  assert.deepEqual(days, [
    {
      date: "2026-11-04",
      models: {
        "claude-sonnet-5-5": { runs: 2, inputTokens: 1000, outputTokens: 250 },
        codex: { runs: 1, inputTokens: 1000, outputTokens: 200 },
      },
    },
  ]);
  days = usage.addUsage(days, request(), NOW + DAY);
  assert.deepEqual(
    days.map((day) => day.date),
    ["2026-11-04", "2026-11-05"],
  );
  assert.deepEqual(
    usage
      .parseUsage(
        { days: [...days, { date: "2025-01-01", models: {} }, { date: "bad" }] },
        NOW + DAY,
      )
      .map((day) => day.date),
    ["2026-11-04", "2026-11-05"],
  );
  assert.deepEqual(
    usage.parseUsage({ days: [{ date: "2026-11-04", models: { m: { runs: -1 } } }] }, NOW)[0]
      .models,
    {},
  );
});

test("notes get a title from their first line, keep their creation time and reject unknown ids", () => {
  const first = notes.saveNote([], { title: "", body: "# Trip plan\n- Hotel" }, 10, "n1");
  assert.deepEqual(first.note, {
    id: "n1",
    title: "Trip plan",
    body: "# Trip plan\n- Hotel",
    createdAt: 10,
    updatedAt: 10,
  });
  const second = notes.saveNote(first.notes, { title: "Ideas", body: "" }, 20, "n2");
  const edited = notes.saveNote(second.notes, { id: "n1", title: "Trip", body: "- Car" }, 30, "x");
  assert.deepEqual(edited.note, {
    id: "n1",
    title: "Trip",
    body: "- Car",
    createdAt: 10,
    updatedAt: 30,
  });
  assert.deepEqual(
    notes.sortNotes(edited.notes).map((note) => note.id),
    ["n1", "n2"],
  );
  assert.equal(notes.noteTitle("", "\n\n"), "Untitled");
  assert.throws(
    () => notes.saveNote(edited.notes, { id: "gone", title: "", body: "" }, 40, "y"),
    /no longer exists/,
  );
  assert.throws(() => notes.parseNoteInput({ body: 3 }), /body must be text/);
  assert.throws(
    () => notes.parseNoteInput({ body: "x".repeat(notes.MAX_NOTE_BODY + 1) }),
    /too long/,
  );
  assert.deepEqual(notes.parseNoteInput({ id: "n1", body: "hi" }), {
    id: "n1",
    title: "",
    body: "hi",
  });
});

test("the JSON store reads once, writes atomically, and starts over from an unreadable file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "dayboard-json-store-"));
  try {
    const file = path.join(dir, "store.json");
    const parse = (value) => ({ items: Array.isArray(value?.items) ? value.items : [] });
    const store = createJsonStore({ path: () => file, parse });
    assert.deepEqual(await store.read(), { items: [] });
    // Concurrent updates apply one after another, so none is lost.
    await Promise.all([
      store.update((value) => ({ items: [...value.items, 1] })),
      store.update((value) => ({ items: [...value.items, 2] })),
    ]);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { items: [1, 2] });
    // A failed change leaves the file and the cache as they were.
    await assert.rejects(
      store.update(() => {
        throw new Error("nope");
      }),
      /nope/,
    );
    assert.deepEqual(await store.read(), { items: [1, 2] });

    await writeFile(file, "{not json");
    const fresh = createJsonStore({ path: () => file, parse });
    assert.deepEqual(await fresh.read(), { items: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
