// UI-only disposable preview. The actual Worker/D1/payment contracts are tested separately.
// This server never contacts Stripe, accepts card details, or touches license/account storage.
import { createServer } from "node:http";
import { buyPage, receiptPage, buyScript, receiptScript } from "../billing/src/pages.ts";

const orderId = "F".repeat(32);
const fixtureKey = `DAYB_${"F".repeat(43)}`;
let polls = 0;
const banner =
  '<aside style="padding:12px;text-align:center;background:#30394a;color:white;font:14px system-ui">Local UI fixture · no payments or real licenses</aside>';
const markup = (page) => page.replace(/(<body[^>]*>)/, `$1${banner}`);

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (url.pathname === "/buy" || url.pathname === "/receipt") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(markup(url.pathname === "/buy" ? buyPage(orderId) : receiptPage));
  } else if (url.pathname === "/buy.js" || url.pathname === "/receipt.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(url.pathname === "/buy.js" ? buyScript : receiptScript);
  } else {
    response.setHeader("Content-Type", "application/json");
    const parts = [];
    for await (const part of request) {
      parts.push(part);
      if (parts.reduce((size, chunk) => size + chunk.length, 0) > 1024) {
        response.writeHead(413).end("{}");
        return;
      }
    }
    let body;
    try {
      body = parts.length ? JSON.parse(Buffer.concat(parts).toString()) : null;
    } catch {
      response.writeHead(400).end("{}");
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/checkout" && body?.orderId === orderId) {
      polls = 0;
      response.end(JSON.stringify({ url: `/receipt?order=${orderId}` }));
    } else if (
      request.method === "GET" &&
      url.pathname === "/v1/checkout/status" &&
      url.searchParams.get("order") === orderId
    ) {
      response.end(JSON.stringify({ state: polls++ === 0 ? "pending" : "ready" }));
    } else if (
      request.method === "POST" &&
      url.pathname === "/v1/checkout/claim" &&
      body?.orderId === orderId
    ) {
      response.end(JSON.stringify({ licenseKey: fixtureKey }));
    } else response.writeHead(404).end("{}");
  }
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  console.log(`Disposable billing UI preview: http://127.0.0.1:${address.port}/buy`);
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close());
