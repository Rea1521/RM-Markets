// Minimal production static server (Railway): long-lived caching for hashed assets
// (CDN friendly), no-cache for index.html, SPA fallback, security headers.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml",
  ".png": "image/png", ".json": "application/json", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const api = process.env.VITE_API_URL || "";
const csp = [
  "default-src 'self'", "img-src 'self' data: https:", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com", "script-src 'self' https://accounts.google.com",
  `connect-src 'self' ${api} ${api.replace(/^http/, "ws")} https://accounts.google.com`, "frame-src https://accounts.google.com",
].join("; ");

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://x");
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(400).end(); return; }
    let isIndex = false;
    try { if ((await stat(file)).isDirectory()) throw 0; } catch { file = join(root, "index.html"); isIndex = true; }
    let body = await readFile(file);
    const ext = extname(file);
    const headers = {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": isIndex || ext === ".html" ? "no-cache" : p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Content-Security-Policy": csp,
    };
    if (/gzip/.test(req.headers["accept-encoding"] || "") && /text|javascript|json|svg/.test(headers["Content-Type"])) {
      body = gzipSync(body); headers["Content-Encoding"] = "gzip";
    }
    res.writeHead(200, headers).end(body);
  } catch (e) { res.writeHead(500).end("error"); }
}).listen(port, "0.0.0.0", () => console.log(`RM Markets web on :${port}`));
