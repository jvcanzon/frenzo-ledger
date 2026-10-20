// Tiny REST helper for the docs table (used by snapshot/import scripts; needs the service role key).
import fs from "node:fs";
export function explain(status, text) {
  if (status === 401 || /JWT|apikey|Invalid API key/i.test(text)) return "the SUPABASE_SERVICE_ROLE_KEY secret doesn't match this project (copy the service_role key again from Project Settings → API)";
  if (status === 404 && /relation|docs|not find the table/i.test(text)) return "the database tables don't exist yet — run supabase/migrations/0001_init.sql in the Supabase SQL Editor first";
  if (status === 404) return "the SUPABASE_URL secret is wrong (it should look like https://xxxx.supabase.co, nothing after .co)";
  return `HTTP ${status}: ${text.slice(0, 300)}`;
}
export function report(lines) { // visible in the Actions summary and in data/last-run.md
  const txt = lines.join("\n"); console.log(txt);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, txt + "\n");
  fs.mkdirSync("data", { recursive: true }); fs.writeFileSync("data/last-run.md", `_${new Date().toISOString()}_\n\n${txt}\n`);
}
export function rest() {
  const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/(rest|auth|storage|functions)\/v1$/, ""), key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const missing = [!url && "SUPABASE_URL", !key && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean);
  if (missing.length) { report([`❌ Missing GitHub secret(s): ${missing.join(", ")} (repository Settings → Secrets and variables → Actions)`]); process.exit(1); }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) { report([`❌ SUPABASE_URL looks wrong: "${url.replace(/[a-z0-9]{6,}/g, m => m.slice(0, 3) + "…")}". It should be https://<project-ref>.supabase.co`]); process.exit(1); }
  const h = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  const fail = async (what, r) => { const t = await r.text(); report([`❌ ${what} failed — ${explain(r.status, t)}`]); process.exit(1); };
  return {
    async check() { const r = await fetch(`${url}/rest/v1/docs?select=id&limit=1`, { headers: h }); if (!r.ok) await fail("Connecting to the database", r); },
    async all() { // every doc, paged
      const out = []; let from = 0; const page = 1000;
      for (;;) {
        const r = await fetch(`${url}/rest/v1/docs?select=collection,id,data,updated_at&order=collection,id`, { headers: { ...h, Range: `${from}-${from + page - 1}` } });
        if (!r.ok) await fail("Reading documents", r);
        const rows = await r.json(); out.push(...rows); if (rows.length < page) break; from += page;
      }
      return out;
    },
    async upsert(rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const r = await fetch(`${url}/rest/v1/docs?on_conflict=collection,id`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
        if (!r.ok) await fail("Writing documents", r);
      }
    }
  };
}
