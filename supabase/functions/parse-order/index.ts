// Reads a pasted customer message (or screenshot) and returns the order as JSON for the form.
// Optional: deploy only if you want the "paste an order" helper in the app.
//   supabase functions deploy parse-order
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// Only the owner may call it; the app sends the signed-in user's token.
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "claude-sonnet-5";

Deno.serve(async (req) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization") || "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "not_granted" }), { status: 401, headers: cors });
    const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (prof?.role !== "owner") return new Response(JSON.stringify({ error: "not_granted" }), { status: 403, headers: cors });

    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers: cors });
    const { prompt, images = [] } = await req.json();
    const content: unknown[] = [];
    for (const img of images) {
      const m = /^data:(image\/[a-z]+);base64,(.+)$/.exec(String(img)); if (!m) continue;
      content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
    content.push({ type: "text", text: String(prompt) + "\n\nAnswer with JSON only, no prose." });
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content }] })
    });
    if (!r.ok) return new Response(JSON.stringify({ error: r.status === 429 ? "rate_limited" : "refused", detail: await r.text() }), { status: 502, headers: cors });
    const out = await r.json();
    const text = (out.content || []).filter((c: { type: string }) => c.type === "text").map((c: { text: string }) => c.text).join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    try { return new Response(JSON.stringify(JSON.parse(json)), { headers: { ...cors, "content-type": "application/json" } }); }
    catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 422, headers: cors }); }
  } catch (e) {
    return new Response(JSON.stringify({ error: "refused", detail: String(e) }), { status: 500, headers: cors });
  }
});
