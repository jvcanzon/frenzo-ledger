// Mirrors the FRENZO Stock Ledger (the artifact, the master copy) into the app's database.
// Input:  an export folder from the ledger (<collection>/<id>.json, raw document data)
//         and data/snapshot.json (what the app currently holds).
// Output: data/inbox/<stamp>-ledger-sync.json with set/delete ops — applied by the "Apply data changes" workflow.
// Usage:  node scripts/ledger-to-app.mjs <export-dir>
import fs from "node:fs"; import path from "node:path";
const exportDir = process.argv[2]; if (!exportDir) { console.error("usage: ledger-to-app.mjs <export-dir>"); process.exit(2); }
const COLLECTIONS = ["catalog", "movements", "invoices", "events", "purchases", "expenses", "eventLogs", "station", "supplies"];
const canon = v => JSON.stringify(sortKeys(v));
function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
const snap = fs.existsSync("data/snapshot.json") ? JSON.parse(fs.readFileSync("data/snapshot.json", "utf8")).collections || {} : {};
const ops = []; const summary = {};
for (const c of COLLECTIONS) {
  const dir = path.join(exportDir, c); const inApp = new Map((snap[c] || []).map(d => [d.id, d.data]));
  const seen = new Set();
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue; const id = f.slice(0, -5); seen.add(id);
    let data = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); if (data && data.data && data.id === id) data = data.data; // tolerate wrapped form
    if (!inApp.has(id) || canon(inApp.get(id)) !== canon(data)) { ops.push({ op: "set", collection: c, id, data }); summary[c] = (summary[c] || 0) + 1; }
  }
  if (!fs.existsSync(dir)) continue; // collection not exported this run: leave the app's copy alone
  for (const id of inApp.keys()) if (!seen.has(id)) { ops.push({ op: "delete", collection: c, id }); summary[c + " deleted"] = (summary[c + " deleted"] || 0) + 1; }
}
if (!ops.length) { console.log("NO_CHANGES"); process.exit(0); }
fs.mkdirSync("data/inbox", { recursive: true });
const file = path.join("data/inbox", new Date().toISOString().replace(/[:.]/g, "-") + "-ledger-sync.json");
fs.writeFileSync(file, JSON.stringify({ source: "FRENZO Stock Ledger (artifact)", ops }, null, 0));
console.log("WROTE " + file + " — " + Object.entries(summary).map(([k, v]) => `${k} ${v}`).join(", "));
