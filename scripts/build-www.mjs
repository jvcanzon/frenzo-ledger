// Builds www/index.html from src/ledger.html: wraps the page in a full document,
// swaps CDN scripts for the bundled copies, and loads the config + adapter + login shell.
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, "..");
let src = fs.readFileSync(path.join(root, "src/ledger.html"), "utf8");

// CDN scripts → local copies (works offline, no third-party loads inside the app).
const swaps = {
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js": "vendor/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js": "vendor/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js": "vendor/xlsx.full.min.js"
};
for (const [from, to] of Object.entries(swaps)) {
  if (!src.includes(from)) throw new Error("Expected script not found: " + from);
  src = src.split(from).join(to);
}
// The artifact page has no <html>/<head>/<body>; give it one, with the runtime shim loaded first
// so the ledger's own `window.claude.use(...)` calls find it.
const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#6b3fa0">
<link rel="icon" href="icon.png">
<script src="vendor/supabase.js"></script>
<script src="js/config.js"></script>
<script src="js/adapter.js"></script>
`;
const titleEnd = src.indexOf("<style>");
const headPart = src.slice(0, titleEnd), rest = src.slice(titleEnd);
const bodyStart = rest.indexOf("</style>") + "</style>".length;
const out = head + headPart + rest.slice(0, bodyStart) + `
<style>body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}</style>
</head>
<body>` + rest.slice(bodyStart) + `
<script src="js/login.js"></script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, "www"), { recursive: true });
fs.writeFileSync(path.join(root, "www/index.html"), out);
console.log("www/index.html written (" + (out.length / 1024).toFixed(0) + " KB)");
