import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const fixture = { handlers: new Map(), broadcasts: [], pending: null };
globalThis.__meetingNotesWiring = fixture;
const stubs = {
  "@glaze/core/backend": `export const app = { getPath: () => '/unused-test-path' }; export const logger = { warn() {} };`,
  "ipc.js": `export const ipcMain = { handle: (name, handler) => globalThis.__meetingNotesWiring.handlers.set(name, handler), broadcast: (...args) => globalThis.__meetingNotesWiring.broadcasts.push(args) };`,
  "mcp-client.js": `export const callMcpTool = () => {}; export const testMcpServer = () => {};`,
  "mcp-test-events.js": `export const onMcpServerTested = () => {};`,
  "demo-data.js": `export const isDemoMode = () => false;`,
  "file-store.js": `export const readFileIfExists = () => {}; export const writeFileAtomic = () => {};`,
  "notes-service.js": `export const createNotesService = () => ({ importNotes: () => globalThis.__meetingNotesWiring.pending });`,
  "settings-store.js": `export const getSettings = async () => ({ system: { meetings: { notesImport: true } } }); export const getMcpServers = async () => [];`,
  "productivity.js": `export const onAccountsChanged = () => {}; export const requireAgendaScope = () => {};`,
};
const plugin = {
  name: "notes-wiring",
  setup(api) {
    api.onResolve({ filter: /.*/ }, (args) => {
      const key = Object.keys(stubs).find(
        (key) => args.path === key || args.path.endsWith(`/${key}`),
      );
      return key ? { path: key, namespace: "stub" } : undefined;
    });
    api.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: stubs[args.path],
      loader: "js",
    }));
  },
};
const { registerMeetingNotesHandlers } = await loadTs("main/handlers/meeting-notes.ts", [plugin]);
registerMeetingNotesHandlers();

test("notes changes broadcast identifiers only, after successful persistence", async () => {
  const pending = Promise.withResolvers();
  fixture.pending = pending.promise;
  const record = {
    calendarId: "primary",
    eventId: "e1",
    text: "Private notes",
    scope: "private-account",
  };
  const imported = fixture.handlers.get("meetings:importNotes")(
    {},
    { selection: "selection", providerMeetingId: "meeting" },
  );
  await Promise.resolve();
  assert.deepEqual(fixture.broadcasts, []);
  pending.resolve(record);
  assert.equal(await imported, record);
  assert.deepEqual(fixture.broadcasts, [
    ["meetings:notesChanged", { calendarId: "primary", eventId: "e1" }],
  ]);
});

test("failed persistence never broadcasts success", async () => {
  fixture.broadcasts.length = 0;
  const pending = Promise.withResolvers();
  fixture.pending = pending.promise;
  const imported = fixture.handlers.get("meetings:importNotes")(
    {},
    { selection: "selection", providerMeetingId: "meeting" },
  );
  const rejected = assert.rejects(imported, /disk unavailable/);
  pending.reject(new Error("disk unavailable"));
  await rejected;
  assert.deepEqual(fixture.broadcasts, []);
});
