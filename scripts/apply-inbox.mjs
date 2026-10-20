// Applies change files dropped in data/inbox/ to the database, then moves them to data/applied/.
// A change file is JSON: { "ops": [ {"op":"set","collection":"invoices","id":"inv-016","data":{...}},
//   {"op":"update","collection":"events","id":"ev-1","data":{"downPayment":5000}}, {"op":"delete","collection":"movements","id":"x"} ] }
// This is how Claude keeps adding bookings and fixing data for you: it commits a file here, GitHub applies it.
import fs from "node:fs"; import path from "node:path";
const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
const deepMerge = (a, b) => { const out = a && typeof a === "object" && !Array.isArray(a) ? { ...a } : {}; for (const [k, v] of Object.entries(b || {})) { if (v && typeof v === "object" && !Array.isArray(v) && v.__delete__ === true) delete out[k]; else if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v); else out[k] = v; } return out; };
const files = fs.existsSync("data/inbox") ? fs.readdirSync("data/inbox").filter(f => f.endsWith(".json")).sort() : [];
for (const f of files) {
  const { ops = [] } = JSON.parse(fs.readFileSync(path.join("data/inbox", f), "utf8"));
  for (const o of ops) {
    const q = `${url}/rest/v1/docs?collection=eq.${encodeURIComponent(o.collection)}&id=eq.${encodeURIComponent(o.id)}`;
    let r;
    if (o.op === "delete") r = await fetch(q, { method: "DELETE", headers: h });
    else if (o.op === "set") r = await fetch(`${url}/rest/v1/docs?on_conflict=collection,id`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ collection: o.collection, id: o.id, data: o.data }]) });
    else if (o.op === "update") r = await fetch(`${url}/rest/v1/rpc/merge_doc`, { method: "POST", headers: h, body: JSON.stringify({ p_collection: o.collection, p_id: o.id, p_patch: o.data }) });
    else throw new Error("unknown op " + o.op);
    if (!r.ok) throw new Error(`${f}: ${o.op} ${o.collection}/${o.id} failed ${r.status} ${await r.text()}`);
    console.log(`${f}: ${o.op} ${o.collection}/${o.id}`);
  }
  fs.mkdirSync("data/applied", { recursive: true });
  fs.renameSync(path.join("data/inbox", f), path.join("data/applied", f));
}
console.log(files.length ? `applied ${files.length} file(s)` : "inbox empty");
