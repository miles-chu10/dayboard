import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = new URL("..", import.meta.url).pathname;
let bundleSequence = 0;

async function loadCodec() {
  const result = await build({
    entryPoints: [path.join(root, "main/platform/reminders-codec.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const source = `${result.outputFiles[0].text}\n// bundle-${bundleSequence++}`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  return import(url);
}

test("encodeRequest produces a single newline-terminated JSON line", async () => {
  const { encodeRequest } = await loadCodec();
  const line = encodeRequest({ id: "abc", op: "status", params: {} });
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.split("\n").filter(Boolean).length, 1);
  assert.deepEqual(JSON.parse(line), { id: "abc", op: "status", params: {} });
});

test("decodeResponse parses a success response", async () => {
  const { decodeResponse } = await loadCodec();
  const response = decodeResponse('{"id":"1","ok":true,"result":"full-access"}');
  assert.deepEqual(response, { id: "1", ok: true, result: "full-access" });
});

test("decodeResponse parses a failure response", async () => {
  const { decodeResponse } = await loadCodec();
  const response = decodeResponse('{"id":"1","ok":false,"error":"boom"}');
  assert.deepEqual(response, { id: "1", ok: false, error: "boom" });
});

test("decodeResponse rejects malformed JSON", async () => {
  const { decodeResponse } = await loadCodec();
  assert.throws(() => decodeResponse("not json"), /invalid response line/);
});

test("decodeResponse rejects a response missing required fields", async () => {
  const { decodeResponse } = await loadCodec();
  assert.throws(() => decodeResponse('{"ok":true}'), /missing required fields/);
  assert.throws(() => decodeResponse('{"id":"1"}'), /missing required fields/);
});

test("LineBuffer yields complete lines and holds back a trailing partial line", async () => {
  const { LineBuffer } = await loadCodec();
  const buffer = new LineBuffer();

  assert.deepEqual(buffer.push('{"id":"1","ok":true,"result":1}\n{"id":"2"'), [
    '{"id":"1","ok":true,"result":1}',
  ]);
  assert.deepEqual(buffer.push(',"ok":true,"result":2}\n'), ['{"id":"2","ok":true,"result":2}']);
  assert.deepEqual(buffer.push(""), []);
});

test("LineBuffer.flush returns a trailing line left without a newline", async () => {
  const { LineBuffer } = await loadCodec();
  const buffer = new LineBuffer();
  buffer.push('{"id":"1","ok":true,"result":1}');
  assert.deepEqual(buffer.flush(), ['{"id":"1","ok":true,"result":1}']);
  assert.deepEqual(buffer.flush(), []);
});

test("LineBuffer skips blank lines between records", async () => {
  const { LineBuffer } = await loadCodec();
  const buffer = new LineBuffer();
  assert.deepEqual(
    buffer.push('{"id":"1","ok":true,"result":1}\n\n{"id":"2","ok":true,"result":2}\n'),
    ['{"id":"1","ok":true,"result":1}', '{"id":"2","ok":true,"result":2}'],
  );
});
