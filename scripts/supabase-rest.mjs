// Tiny REST helper for the docs table (used by snapshot/import scripts; needs the service role key).
export function rest() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const h = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json" };
  return {
    async all() { // every doc, paged
      const out = []; let from = 0; const page = 1000;
      for (;;) {
        const r = await fetch(`${url}/rest/v1/docs?select=collection,id,data,updated_at&order=collection,id`, { headers: { ...h, Range: `${from}-${from + page - 1}` } });
        if (!r.ok) throw new Error("read failed " + r.status + " " + await r.text());
        const rows = await r.json(); out.push(...rows); if (rows.length < page) break; from += page;
      }
      return out;
    },
    async upsert(rows) {
      for (let i = 0; i < rows.length; i += 200) {
        const r = await fetch(`${url}/rest/v1/docs?on_conflict=collection,id`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
        if (!r.ok) throw new Error("write failed " + r.status + " " + await r.text());
      }
    }
  };
}
