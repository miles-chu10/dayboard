import assert from "node:assert/strict";
import test from "node:test";
import { QueryClient } from "@tanstack/react-query";

import { clearAccountScopedQueries } from "./account-scoped-queries";

test("an account change drops every cached meeting-notes query", () => {
  const client = new QueryClient();
  client.setQueryData(["meetings", "notes", "google:a", "primary", "e1"], { text: "A's notes" });
  client.setQueryData(["meetings", "snapshot-notes", "google:a", []], { "primary/e1": {} });
  client.setQueryData(["meetings", "notes-status"], { provider: null });
  client.setQueryData(["tasks"], { state: "ok", items: [] });
  clearAccountScopedQueries(client);
  assert.equal(client.getQueryData(["meetings", "notes", "google:a", "primary", "e1"]), undefined);
  assert.equal(client.getQueryData(["meetings", "snapshot-notes", "google:a", []]), undefined);
  assert.equal(client.getQueryData(["meetings", "notes-status"]), undefined);
  assert.deepEqual(client.getQueryData(["tasks"]), { state: "ok", items: [] });
});
