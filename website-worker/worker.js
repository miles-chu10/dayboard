/* global URL, Headers, Response */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === "http:" || url.hostname.startsWith("www.")) {
      url.protocol = "https:";
      url.hostname = url.hostname.replace(/^www\./, "");
      return Response.redirect(url.toString(), 301);
    }
    const response = await env.ASSETS.fetch(request);
    if (!url.pathname.endsWith(".mp4") || request.method !== "GET" || response.status !== 200) {
      return response;
    }
    return byteRange(request, response);
  },
};

// The assets binding ignores Range, but Safari only plays video that it can fetch in parts.
async function byteRange(request, response) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  const ifRange = request.headers.get("If-Range");
  const headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  if (!range || (!range[1] && !range[2]) || (ifRange && ifRange !== headers.get("ETag"))) {
    return new Response(response.body, { status: 200, headers });
  }
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (start >= size || start > end) {
    headers.set("Content-Range", `bytes */${size}`);
    headers.delete("Content-Length");
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
