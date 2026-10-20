// One-time migration: loads seed/snapshot.json (exported from the old ledger) into the new database.
// Existing docs with the same id are overwritten; nothing else is touched. Safe to run again.
import fs from "node:fs"; import { rest } from "./supabase-rest.mjs";
const file = process.argv[2] || "seed/snapshot.json";
const { collections } = JSON.parse(fs.readFileSync(file, "utf8"));
const rows = []; for (const [c, docs] of Object.entries(collections)) for (const d of docs) rows.push({ collection: c, id: d.id, data: d.data });
await rest().upsert(rows);
console.log("imported", rows.length, "documents from", file);
