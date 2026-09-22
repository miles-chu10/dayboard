import assert from "node:assert/strict";
import test from "node:test";
import { drainAssistantOperations, trackAssistantOperation } from "../renderer/lib/assistant-operations.ts";

test("a remounted history read waits for both provider creation and its durable chat update", async () => {
  let created, saved;
  const provider = new Promise(resolve => { created = resolve; });
  const persistence = new Promise(resolve => { saved = resolve; });
  const order = [];
  const operation = trackAssistantOperation(async () => {
    await provider;
    order.push("created");
    await persistence;
    order.push("saved");
  });
  const read = drainAssistantOperations().then(() => order.push("read"));
  created();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(order, ["created"]);
  saved();
  await Promise.all([operation, read]);
  assert.deepEqual(order, ["created", "saved", "read"]);
});

test("failed creation releases the route barrier without claiming success", async () => {
  const operation = trackAssistantOperation(async () => { throw new Error("synthetic failure"); });
  await assert.rejects(operation, /synthetic failure/);
  await drainAssistantOperations();
});
