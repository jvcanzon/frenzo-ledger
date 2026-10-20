// Packs seed/export/<collection>/<id>.json (the export of the old ledger) into one seed/snapshot.json
import fs from "node:fs"; import path from "node:path";
const root = path.resolve(new URL(".", import.meta.url).pathname, ".."), src = path.join(root, "seed/export");
const out = {};
for (const c of fs.readdirSync(src)) { const d = path.join(src, c); if (!fs.statSync(d).isDirectory()) continue;
  out[c] = fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => ({ id: f.slice(0, -5), data: JSON.parse(fs.readFileSync(path.join(d, f), "utf8")) })); }
fs.writeFileSync(path.join(root, "seed/snapshot.json"), JSON.stringify({ exportedAt: new Date().toISOString(), collections: out }, null, 1));
console.log(Object.entries(out).map(([c, r]) => c + " " + r.length).join(", "));
