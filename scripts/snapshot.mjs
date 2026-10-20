// Dumps every document to data/snapshot.json (grouped by collection) — the file the
// scheduled Claude tasks read (calendar sync, Household Ledger sync, backups, alerts).
import fs from "node:fs"; import { rest } from "./supabase-rest.mjs";
const db = rest(); await db.check(); const rows = await db.all(); const collections = {};
for (const r of rows) (collections[r.collection] ||= []).push({ id: r.id, data: r.data, updatedAt: r.updated_at });
fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/snapshot.json", JSON.stringify({ exportedAt: new Date().toISOString(), counts: Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, v.length])), collections }, null, 1));
console.log("snapshot:", Object.entries(collections).map(([k, v]) => `${k} ${v.length}`).join(", "));
