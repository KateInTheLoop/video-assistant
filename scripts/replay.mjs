// Source-checkout development tool. Only these assets are served, never recordings or
// other repository files. The browser opens a chosen recording directly as a blob URL.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const root = new URL("../dev/replay/", import.meta.url);
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/replay.css", ["replay.css", "text/css; charset=utf-8"]],
  ["/replay.js", ["replay.js", "text/javascript; charset=utf-8"]],
  ["/playback.js", ["playback.js", "text/javascript; charset=utf-8"]],
]);

export function createReplayServer() {
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; media-src blob:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Only GET and HEAD are supported.");
      return;
    }
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404); response.end("Not found"); return; }
    try {
      const body = await readFile(new URL(asset[0], root));
      response.writeHead(200, { "Content-Type": asset[1], "Content-Length": body.length });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(500);
      response.end("Replay assets could not be read. Run this from a complete source checkout.");
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const args = process.argv.slice(2);
  const portText = args.length === 0 ? "8765" : args.length === 2 && args[0] === "--port" ? args[1] : "";
  if (!/^\d+$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) {
    console.error("Usage: npm run replay -- [--port 8765]");
    process.exitCode = 1;
  } else {
    const server = createReplayServer();
    server.on("error", error => {
      console.error(error.code === "EADDRINUSE"
        ? `Port ${portText} is in use. Try npm run replay -- --port ${Number(portText) < 65535 ? Number(portText) + 1 : 8765}`
        : `Replay server failed: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(Number(portText), "127.0.0.1", () => {
      console.log(`Open http://127.0.0.1:${server.address().port} in Chrome and choose a recording.`);
      console.log('In the coach: Capture call audio → Chrome Tab → Interview replay — Coach → Share tab audio.');
      console.log("Leave Capture my mic off for a recording with both speakers. Ctrl+C stops the server.");
    });
  }
}
