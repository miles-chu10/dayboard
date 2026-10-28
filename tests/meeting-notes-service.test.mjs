import assert from "node:assert/strict";
import test from "node:test";
import { loadTs } from "./helpers/load-ts.mjs";

const { createNotesService } = await loadTs("main/services/meeting-notes/notes-service.ts");

const ROADMAP = "11111111-1111-4111-8111-111111111111";
const LIST = `<meetings_data count="1"><meeting id="${ROADMAP}" title="Roadmap" meeting_at="2026-10-20T09:02:00.000-07:00" url="https://notes.granola.ai/d/${ROADMAP}"></meeting></meetings_data>`;
const NOTES = `<meetings_data count="1"><meeting id="${ROADMAP}" title="Roadmap"><summary>
# Next Steps
- **Draft the launch email**
</summary></meeting></meetings_data>`;

const granolaServer = (overrides = {}) => ({
  id: "server-1",
  name: "Granola",
  enabled: true,
  transport: "stdio",
  command: "npx",
  args: ["-y", "mcp-remote", "https://mcp.granola.ai/mcp"],
  env: {},
  url: "",
  headers: {},
  ...overrides,
});

function harness(options = {}) {
  const files = new Map();
  const state = {
    scope: "account-a",
    demo: options.demo ?? false,
    servers: [granolaServer()],
    clock: new Date("2026-10-20T17:00:00Z"),
    ids: 0,
    calls: [],
    responses: {
      list_meetings: { text: LIST, isError: false, truncated: false },
      get_meetings: { text: NOTES, isError: false, truncated: false },
    },
  };
  const service = createNotesService({
    isDemoMode: () => state.demo,
    currentScope: async () => state.scope,
    enabledServers: async () => state.servers.filter((server) => server.enabled),
    testServer: async () => ({ ok: true, tools: ["list_meetings", "get_meetings"], error: null }),
    callTool: async (server, tool, args) => {
      state.calls.push([server.id, tool, args]);
      await options.duringCall?.(state, tool);
      return state.responses[tool];
    },
    readFile: async (name) => files.get(name) ?? null,
    writeFile: async (name, text) => {
      files.set(name, text);
    },
    now: () => state.clock,
    newId: () => `selection-${++state.ids}`,
  });
  return { service, state, files };
}

const event = {
  calendarId: "primary",
  eventId: "event-1",
  title: "Weekly product sync",
  start: "2026-10-20T16:00:00Z",
  end: "2026-10-20T16:30:00Z",
};

async function ready(options) {
  const h = harness(options);
  await h.service.recordFingerprint(granolaServer(), [
    "list_meetings",
    "get_meetings",
    "query_granola_meetings",
  ]);
  return h;
}

test("records Granola fingerprints only for list_meetings plus get_meetings", async () => {
  const { service } = harness();
  await service.recordFingerprint(granolaServer(), ["list_meetings"]);
  assert.equal((await service.notesStatus()).provider, null);
  await service.recordFingerprint(granolaServer(), ["list_meetings", "get_meetings"]);
  assert.deepEqual((await service.notesStatus()).provider, { id: "server-1", name: "Granola" });
});

test("ignores a fingerprint after the server's command or URL changes", async () => {
  const { service, state } = await ready();
  state.servers = [granolaServer({ args: ["-y", "mcp-remote", "https://elsewhere.example/mcp"] })];
  assert.equal((await service.notesStatus()).provider, null);
});

test("records fingerprints by configuration, so Test then Save keeps the provider", async () => {
  const { service, state } = harness();
  await service.recordFingerprint(granolaServer({ id: "" }), ["list_meetings", "get_meetings"]);
  state.servers = [granolaServer({ id: "saved-id" })];
  assert.deepEqual((await service.notesStatus()).provider, { id: "saved-id", name: "Granola" });
});

test("finds, imports and returns notes for the current account", async () => {
  const { service, state } = await ready();
  const found = await service.findNotes(event);
  assert.equal(found.match?.id, ROADMAP);
  assert.deepEqual(state.calls[0], [
    "server-1",
    "list_meetings",
    { time_range: "custom", custom_start: "2026-10-20", custom_end: "2026-10-20" },
  ]);
  const record = await service.importNotes({
    selection: found.selection,
    providerMeetingId: ROADMAP,
  });
  assert.match(record.text, /Draft the launch email/);
  assert.equal(record.providerUrl, `https://notes.granola.ai/d/${ROADMAP}`);
  const notes = await service.getNotes([{ calendarId: "primary", eventId: "event-1" }]);
  assert.equal(notes["primary/event-1"].providerMeetingId, ROADMAP);
});

test("rejects an import with an unknown, expired or reused selection", async () => {
  const { service, state } = await ready();
  await assert.rejects(
    service.importNotes({ selection: "nope", providerMeetingId: ROADMAP }),
    /expired/,
  );
  const found = await service.findNotes(event);
  await service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP });
  await assert.rejects(
    service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP }),
    /expired/,
  );
  const later = await service.findNotes(event);
  state.clock = new Date(state.clock.getTime() + 11 * 60_000);
  await assert.rejects(
    service.importNotes({ selection: later.selection, providerMeetingId: ROADMAP }),
    /expired/,
  );
});

test("rejects a meeting ID that was not offered", async () => {
  const { service } = await ready();
  const found = await service.findNotes(event);
  await assert.rejects(
    service.importNotes({
      selection: found.selection,
      providerMeetingId: "99999999-9999-4999-8999-999999999999",
    }),
    /wasn't offered/,
  );
});

test("rejects an import after the provider's configuration changed", async () => {
  const { service, state } = await ready();
  const found = await service.findNotes(event);
  state.servers = [granolaServer({ command: "node" })];
  await assert.rejects(
    service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP }),
    /changed/,
  );
});

test("does not store an MCP error or empty result as notes", async () => {
  for (const response of [
    { text: "Tool error: access denied", isError: true, truncated: false },
    { text: "   ", isError: false, truncated: false },
  ]) {
    const { service, state } = await ready();
    const found = await service.findNotes(event);
    state.responses.get_meetings = response;
    await assert.rejects(
      service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP }),
    );
    assert.deepEqual(await service.getNotes([{ calendarId: "primary", eventId: "event-1" }]), {});
  }
});

test("discards an import that finishes after an account change", async () => {
  const { service } = await ready({
    duringCall: async (state, tool) => {
      if (tool === "get_meetings") state.scope = "account-b";
    },
  });
  const found = await service.findNotes(event);
  await assert.rejects(
    service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP }),
    /account changed/,
  );
});

test("returns only the current account's notes", async () => {
  const { service, state } = await ready();
  const found = await service.findNotes(event);
  await service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP });
  state.scope = "account-b";
  assert.deepEqual(await service.getNotes([{ calendarId: "primary", eventId: "event-1" }]), {});
});

test("notes store keeps the newest 200", async () => {
  const { service, state } = await ready();
  for (let index = 0; index < 202; index += 1) {
    const found = await service.findNotes({ ...event, eventId: `event-${index}` });
    state.clock = new Date(state.clock.getTime() + 1000);
    await service.importNotes({ selection: found.selection, providerMeetingId: ROADMAP });
  }
  const notes = await service.getNotes([
    { calendarId: "primary", eventId: "event-0" },
    { calendarId: "primary", eventId: "event-201" },
  ]);
  assert.deepEqual(Object.keys(notes), ["primary/event-201"]);
});

test("nothing is stored in demo mode", async () => {
  const { service, files } = harness({ demo: true });
  await service.recordFingerprint(granolaServer(), ["list_meetings", "get_meetings"]);
  await assert.rejects(service.findNotes(event), /demo mode/);
  assert.deepEqual(await service.getNotes([{ calendarId: "primary", eventId: "event-1" }]), {});
  assert.equal(files.size, 0);
});

test("a truncated meeting list never offers an incomplete match", async () => {
  const { service, state, files } = await ready();
  state.responses.list_meetings.truncated = true;
  await assert.rejects(service.findNotes(event), /incomplete meeting list/);
  assert.equal(files.has("notes.json"), false);
});

test("truncated notes never overwrite a previously complete import", async () => {
  const { service, state, files } = await ready();
  const first = await service.findNotes(event);
  await service.importNotes({ selection: first.selection, providerMeetingId: ROADMAP });
  const before = files.get("notes.json");
  const next = await service.findNotes(event);
  state.responses.get_meetings = { text: "Partial replacement", isError: false, truncated: true };
  await assert.rejects(
    service.importNotes({ selection: next.selection, providerMeetingId: ROADMAP }),
    /incomplete notes/,
  );
  assert.equal(files.get("notes.json"), before);
});
