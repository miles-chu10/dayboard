import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_COMMANDS,
  ASSISTANT_SUGGESTIONS,
  PROMPT_COMMANDS,
  commandSections,
  parseModeArgument,
  slashInput,
} from "./assistant-commands";

function names(text: string, demo = false): [string, string[]][] {
  return commandSections(text, { demo }).map((section) => [
    section.title,
    section.commands.map((command) => command.name),
  ]);
}

test("a slash alone lists every action, then every prompt", () => {
  assert.deepEqual(names("/"), [
    ["Actions", ["new", "history", "model", "effort", "mode", "attach", "mcp", "settings"]],
    ["Prompts", ["focus", "replies", "free", "overdue", "brief", "week"]],
  ]);
});

test("demo mode leaves out /attach", () => {
  assert.deepEqual(names("/", true)[0], [
    "Actions",
    ["new", "history", "model", "effort", "mode", "mcp", "settings"],
  ]);
  assert.deepEqual(names("/attach", true), []);
});

test("an exact name comes first, then name matches, then description matches", () => {
  assert.deepEqual(names("/mode"), [["Actions", ["mode", "model"]]]);
  assert.deepEqual(names("/mo"), [
    ["Actions", ["model", "mode"]],
    ["Prompts", ["free"]],
  ]);
  assert.deepEqual(names("/MO"), names("/mo"));
});

test("the menu closes without a match, off the first character or across lines", () => {
  assert.deepEqual(names("/zzz"), []);
  assert.deepEqual(names("hello /new"), []);
  assert.deepEqual(names("/new\nmore"), []);
  assert.deepEqual(names(""), []);
});

test("after the command word only a command that takes an argument stays", () => {
  assert.deepEqual(names("/effort extra high"), [["Actions", ["effort"]]]);
  assert.deepEqual(names("/mode "), [["Actions", ["mode"]]]);
  assert.deepEqual(names("/focus now"), []);
  assert.deepEqual(names("/effortless x"), []);
  assert.deepEqual(slashInput("/Effort  Extra High"), { name: "effort", argument: "Extra High" });
  assert.deepEqual(slashInput("/new"), { name: "new", argument: "" });
  assert.equal(slashInput("new"), null);
});

test("the first four prompts are the empty-state suggestions", () => {
  assert.deepEqual(
    PROMPT_COMMANDS.slice(0, 4).map((command) => command.prompt),
    ASSISTANT_SUGGESTIONS,
  );
  assert.equal(
    PROMPT_COMMANDS.find((command) => command.name === "brief")?.prompt,
    "Give me a short briefing for today: my meetings, what's due, and emails that need attention.",
  );
  assert.equal(
    PROMPT_COMMANDS.find((command) => command.name === "week")?.prompt,
    "Review my week: what got done, what slipped, and what to focus on next week.",
  );
  assert.ok(ACTION_COMMANDS.every((command) => command.kind === "action"));
  assert.ok(
    PROMPT_COMMANDS.every(
      (command) => command.kind === "prompt" && command.description === command.prompt,
    ),
  );
});

test("/mode reads the three permission modes by value or label", () => {
  const cases = [
    ["read-only", "read-only"],
    ["Read only", "read-only"],
    ["readonly", "read-only"],
    ["ask", "ask"],
    ["Ask first", "ask"],
    ["AUTO", "auto"],
    ["yolo", null],
    ["", null],
  ] as const;
  for (const [text, mode] of cases) assert.equal(parseModeArgument(text), mode, text);
});
