import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { setTimeout } from "node:timers";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let sequence = 0;
const stubs = {
  react: `export const useRef = value => ({ current: value }); export const useEffect = () => {};`,
  "@tanstack/react-query": `export const useQueryClient = () => globalThis.__completion.client; export const useMutation = options => options; export const useQuery = options => options;`,
  "@glaze/core/components": `export const toast = { success: (...args) => globalThis.__completion.success.push(args), error: message => globalThis.__completion.errors.push(message) };`,
  "./ipc": `export const invoke = (channel, input) => globalThis.__completion.invoke(channel, input); export const errorMessage = error => error.message;`,
  "./settings": `export const settingsQueryKey = ["settings"]; export const sourceOn = () => true; export const useSettings = () => ({isSuccess: true});`,
};

async function harness({ tasks = [], reminders = [], links = [], invoke } = {}) {
  const cache = new Map();
  const key = value => JSON.stringify(value);
  const fixture = {
    success: [], errors: [], calls: [],
    client: {
      getQueryData: query => cache.get(key(query)),
      setQueryData(query, value) {
        const next = typeof value === "function" ? value(cache.get(key(query))) : value;
        cache.set(key(query), next);
        return next;
      },
      cancelQueries: async () => {},
      // No refresh can repair optimistic state in these tests.
      invalidateQueries: async () => {},
    },
    async invoke(channel, input) {
      fixture.calls.push({ channel, input });
      return invoke?.(channel, input);
    },
  };
  fixture.client.setQueryData(["tasks"], { state: "ok", items: tasks });
  fixture.client.setQueryData(["reminders"], { state: "ok", items: reminders });
  fixture.client.setQueryData(["agenda", "scope"], "fixture-account");
  fixture.client.setQueryData(["agenda", "state", "fixture-account"], { focusKeys: [], duplicateLinks: links, scheduledBlocks: [] });
  globalThis.__completion = fixture;
  const bundle = await build({
    entryPoints: [path.join(root, "renderer/lib/queries.ts")], bundle: true,
    platform: "node", format: "esm", write: false, logLevel: "silent",
    plugins: [{ name: "completion-fixtures", setup(api) {
      api.onResolve({ filter: /.*/ }, args => stubs[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
    } }],
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n//${sequence++}`).toString("base64")}`);
  const mutation = module.useToggleTodo();
  return {
    ...fixture,
    async toggle(todo) {
      let context, result, failure;
      try {
        context = await mutation.onMutate(todo);
        result = await mutation.mutationFn(todo);
        await mutation.onSuccess(result, todo, context);
      } catch (error) {
        failure = error;
        await mutation.onError(error, todo, context);
      } finally {
        await mutation.onSettled(result, failure, todo, context);
      }
      if (failure) throw failure;
    },
  };
}

const task = (id, completed = false) => ({ id, listId: "list", listTitle: "Tasks", title: id, completed, completedAt: null, notes: null, due: null });
const reminder = (ref, completed = false) => ({ ref, identity: "stable-reminder", listTitle: "Reminders", title: "Reminder", completed, completedAt: null, notes: null, dueDate: null, dueTime: null, priority: 0, recurring: false });
const todo = item => ({ key: `task:${item.listId}:${item.id}`, source: "tasks", title: item.title, task: item, completed: item.completed });
const link = (leftKey, rightKey) => ({ leftKey, rightKey, status: "accepted" });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test("completion traverses a cycle and Undo changes only successfully changed participants", async () => {
  const a = task("a"), c = task("c", true), b = reminder("old-ref");
  const h = await harness({ tasks: [a, c], reminders: [b], links: [link("task:list:a", "reminder:stable-reminder"), link("reminder:stable-reminder", "task:list:c"), link("task:list:c", "task:list:a")], invoke: async (channel, input) => channel === "reminders:setCompleted" ? reminder(input.completed ? "new-ref" : "undo-ref", input.completed) : undefined });
  await h.toggle(todo(a));
  assert.equal(h.calls.length, 2);
  assert.equal(h.client.getQueryData(["reminders"]).items[0].ref, "new-ref");
  await h.success.at(-1)[1].action.onClick();
  await tick();
  assert.deepEqual(h.calls.map(call => [call.input.taskId ?? call.input.ref, call.input.completed]), [["a", true], ["old-ref", true], ["a", false], ["new-ref", false]]);
  assert.equal(h.client.getQueryData(["tasks"]).items.find(item => item.id === "c").completed, true);
  assert.equal(h.client.getQueryData(["reminders"]).items[0].ref, "undo-ref");
});

test("failed partner rolls back immediately even when refresh supplies no data", async () => {
  const a = task("a"), b = reminder("old-ref");
  const h = await harness({ tasks: [a], reminders: [b], links: [link("task:list:a", "reminder:stable-reminder")], invoke: async channel => { if (channel === "reminders:setCompleted") throw new Error("fixture write failed"); } });
  await h.toggle(todo(a));
  assert.equal(h.client.getQueryData(["tasks"]).items[0].completed, true);
  assert.equal(h.client.getQueryData(["reminders"]).items[0].completed, false);
  assert.equal(h.errors.length, 1);
  await h.success.at(-1)[1].action.onClick();
  await tick();
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls.at(-1).input.taskId, "a");
});

test("primary failure rolls back every optimistic participant", async () => {
  const a = task("a"), b = reminder("old-ref");
  const h = await harness({ tasks: [a], reminders: [b], links: [link("task:list:a", "reminder:stable-reminder")], invoke: async () => { throw new Error("offline"); } });
  await assert.rejects(h.toggle(todo(a)), /offline/);
  assert.equal(h.client.getQueryData(["tasks"]).items[0].completed, false);
  assert.equal(h.client.getQueryData(["reminders"]).items[0].completed, false);
  assert.equal(h.calls.length, 1);
});

test("recurring completion displays next canonical occurrence and offers no unsafe Undo", async () => {
  const a = task("a"), b = { ...reminder("old-ref"), recurring: true };
  const h = await harness({ tasks: [a], reminders: [b], links: [link("task:list:a", "reminder:stable-reminder")], invoke: async channel => channel === "reminders:setCompleted" ? { ...b, ref: "next-occurrence", completed: false, dueDate: "2026-09-23" } : undefined });
  await h.toggle(todo(a));
  assert.equal(h.client.getQueryData(["reminders"]).items[0].completed, false);
  assert.equal(h.client.getQueryData(["reminders"]).items[0].ref, "next-occurrence");
  assert.equal(h.success.at(-1)[1].action, undefined);
  assert.match(h.success.at(-1)[1].description, /recurring/);
});

test("Undo cannot cross account scopes or run twice", async () => {
  const a = task("a");
  const h = await harness({ tasks: [a] });
  await h.toggle(todo(a));
  const undo = h.success.at(-1)[1].action.onClick;
  h.client.setQueryData(["agenda", "scope"], "different-account");
  await undo(); await tick();
  assert.equal(h.calls.length, 1);
  h.client.setQueryData(["agenda", "scope"], "fixture-account");
  await undo(); await undo(); await tick();
  assert.equal(h.calls.length, 2);
});
