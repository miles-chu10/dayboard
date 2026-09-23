import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { build } from "esbuild";

const result = await build({
  entryPoints: [new URL("../shared/license-config.ts", import.meta.url).pathname],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { parseDesktopLicenseConfig } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

test("a public license binding normalizes the HTTPS origin and keeps its environment explicit", () => {
  assert.deepEqual(
    parseDesktopLicenseConfig({
      apiUrl: "https://LICENSES.example.invalid:443/",
      productId: "prod_fixture",
      environment: "test",
    }),
    {
      apiUrl: "https://licenses.example.invalid",
      issuer: "https://licenses.example.invalid",
      productId: "prod_fixture",
      environment: "test",
    },
  );
});

test("incomplete or unsafe license destinations cannot configure the app", () => {
  const valid = {
    apiUrl: "https://licenses.example.invalid",
    productId: "prod_fixture",
    environment: "live",
  };
  for (const apiUrl of [
    "",
    "http://licenses.example.invalid",
    "file:///tmp/service",
    "https://user:password@licenses.example.invalid",
    "https://licenses.example.invalid/api",
    "https://licenses.example.invalid?key=fixture",
    "https://licenses.example.invalid/#fragment",
  ]) {
    assert.equal(parseDesktopLicenseConfig({ ...valid, apiUrl }), null);
  }
  for (const productId of ["", "price_fixture", "prod_bad/id", "12345"]) {
    assert.equal(parseDesktopLicenseConfig({ ...valid, productId }), null);
  }
  for (const environment of ["", "production", "true"]) {
    assert.equal(parseDesktopLicenseConfig({ ...valid, environment }), null);
  }
});
